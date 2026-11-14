mod base;
mod maj;
mod mcp;
mod navigateur;
mod nolio;
mod secrets;
mod strava;

use rusqlite::Connection;
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Connexion unique à la base chiffrée, partagée entre les commandes.
struct Base(Mutex<Connection>);

fn verrou(b: &Base) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    b.0.lock().map_err(|_| "base verrouillée par une erreur précédente".to_string())
}

#[tauri::command]
fn db_select(b: State<'_, Base>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    base::selectionner(&*verrou(b.inner())?, &sql, &params)
}

#[tauri::command]
fn db_execute(b: State<'_, Base>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    base::executer(&*verrou(b.inner())?, &sql, &params)
}

#[derive(serde::Deserialize)]
struct Ordre {
    sql: String,
    params: Vec<Value>,
}

#[tauri::command]
fn db_batch(b: State<'_, Base>, lot: Vec<Ordre>) -> Result<usize, String> {
    let lot: Vec<(String, Vec<Value>)> = lot.into_iter().map(|o| (o.sql, o.params)).collect();
    base::executer_lot(&*verrou(b.inner())?, &lot)
}

/// L'interface peut écrire, tester la présence et effacer un secret ; elle ne peut jamais en lire un.
#[tauri::command]
fn secret_definir(nom: String, valeur: String) -> Result<(), String> {
    secrets::definir(&nom, &valeur)
}

#[tauri::command]
fn secret_existe(nom: String) -> Result<bool, String> {
    secrets::existe(&nom)
}

#[tauri::command]
fn secret_supprimer(nom: String) -> Result<(), String> {
    secrets::supprimer(&nom)
}

#[derive(serde::Serialize)]
struct EtatNavigateur {
    installes: Vec<navigateur::Detecte>,
    /// Le navigateur qui serait utilisé maintenant (copie téléchargée en premier, sinon un Chromium installé).
    choisi: Option<navigateur::Detecte>,
    copie_telechargee: bool,
    version_epinglee: &'static str,
    /// Taille du téléchargement en octets, absente si Chrome for Testing n'existe pas pour ce système.
    taille_telechargement: Option<u64>,
}

fn dossier_app(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn navigateur_etat(app: AppHandle) -> Result<EtatNavigateur, String> {
    let d = dossier_app(&app)?;
    let choisi = navigateur::choisir(&d);
    Ok(EtatNavigateur {
        installes: navigateur::detecter(),
        copie_telechargee: choisi.as_ref().is_some_and(|c| c.nom.starts_with("Chrome for Testing")),
        choisi,
        version_epinglee: navigateur::VERSION,
        taille_telechargement: navigateur::plateforme().map(|p| p.taille),
    })
}

static TELECHARGEMENT_EN_COURS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Clone, serde::Serialize)]
struct Progression {
    recus: u64,
    total: u64,
}

/// Télécharge Chrome for Testing (vérifié par SHA-256). Progression par l'événement `navigateur-progression`. Un seul à la fois.
#[tauri::command]
async fn navigateur_telecharger(app: AppHandle) -> Result<String, String> {
    use std::sync::atomic::Ordering;
    if TELECHARGEMENT_EN_COURS.swap(true, Ordering::SeqCst) {
        return Err("un téléchargement est déjà en cours".into());
    }
    let d = dossier_app(&app)?;
    let a = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut dernier = std::time::Instant::now() - std::time::Duration::from_secs(1);
        navigateur::installer_cft(&d, |recus, total| {
            if dernier.elapsed() >= std::time::Duration::from_millis(200) || recus == total {
                dernier = std::time::Instant::now();
                let _ = a.emit("navigateur-progression", Progression { recus, total });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    TELECHARGEMENT_EN_COURS.store(false, Ordering::SeqCst);
    r.map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn navigateur_annuler() {
    navigateur::ANNULER.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Lance le navigateur choisi sans fenêtre avec un profil de test, lit sa version, le referme.
#[tauri::command]
async fn navigateur_tester(app: AppHandle) -> Result<String, String> {
    let d = dossier_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let nav = navigateur::choisir(&d).ok_or("aucun navigateur disponible : installe Chrome, Edge ou Chromium, ou télécharge Chrome for Testing")?;
        let mut s = navigateur::lancer(std::path::Path::new(&nav.chemin), &d.join("navigateur").join("profils").join("test"), false, "about:blank")?;
        let v = s.version();
        s.fermer();
        v.map(|v| format!("{} ({v})", nav.nom))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Sources lues par le navigateur piloté (Nolio, Strava) : lecture seule ----------

static NAV_OCCUPE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static NAV_ANNULER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Une seule tâche du navigateur piloté à la fois (connexion ou synchronisation, Nolio ou Strava) : simple, et jamais deux fenêtres ouvertes.
struct OccupeNavigateur;
impl OccupeNavigateur {
    fn prendre() -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        if NAV_OCCUPE.swap(true, Ordering::SeqCst) {
            return Err("Le navigateur de l'appli est déjà en cours d'utilisation".into());
        }
        NAV_ANNULER.store(false, Ordering::SeqCst);
        Ok(OccupeNavigateur)
    }
}
impl Drop for OccupeNavigateur {
    fn drop(&mut self) {
        NAV_OCCUPE.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

fn profil_nolio(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(dossier_app(app)?.join("navigateur").join("profils").join("nolio"))
}

fn navigateur_choisi(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let nav = navigateur::choisir(&dossier_app(app)?).ok_or("aucun navigateur disponible : installe Chrome, Edge ou Chromium, ou télécharge Chrome for Testing")?;
    Ok(std::path::PathBuf::from(nav.chemin))
}

/// Ouvre une fenêtre sur Nolio : l'utilisateur s'y connecte lui-même (rien n'est rempli ni stocké par l'appli). Rend la main une fois connecté.
#[tauri::command]
async fn nolio_connecter(app: AppHandle) -> Result<(), String> {
    let occupe = OccupeNavigateur::prendre()?;
    let (exe, profil) = (navigateur_choisi(&app)?, profil_nolio(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        nolio::connecter(&exe, &profil, nolio::ORIGINE, &NAV_ANNULER, std::time::Duration::from_secs(600))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lit le calendrier Nolio (35 jours passés, 200 à venir ; commentaires et structures jusqu'à 21 jours à venir) sans fenêtre.
#[tauri::command]
async fn nolio_synchroniser(app: AppHandle) -> Result<nolio::Bilan, String> {
    let occupe = OccupeNavigateur::prendre()?;
    let (exe, profil) = (navigateur_choisi(&app)?, profil_nolio(&app)?);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        let aujourdhui = nolio::aujourd_hui();
        let (debut, fin, fiches) = (nolio::decaler(&aujourdhui, -35)?, nolio::decaler(&aujourdhui, 200)?, nolio::decaler(&aujourdhui, 21)?);
        let base = a.state::<Base>();
        let evenements = a.clone();
        nolio::synchroniser(
            &exe,
            &profil,
            nolio::ORIGINE,
            &debut,
            &fin,
            &fiches,
            &NAV_ANNULER,
            |evs| nolio::enregistrer(&*verrou(base.inner())?, evs, &aujourdhui),
            |fait, total| {
                let _ = evenements.emit("nolio-progression", Progression { recus: fait as u64, total: total as u64 });
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn profil_strava(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(dossier_app(app)?.join("navigateur").join("profils").join("strava"))
}

/// Ouvre une fenêtre sur Strava : l'utilisateur s'y connecte lui-même (rien n'est rempli ni stocké par l'appli). Rend la main une fois connecté.
#[tauri::command]
async fn strava_connecter(app: AppHandle) -> Result<(), String> {
    let occupe = OccupeNavigateur::prendre()?;
    let (exe, profil) = (navigateur_choisi(&app)?, profil_strava(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        strava::connecter(&exe, &profil, strava::ORIGINE, &NAV_ANNULER, std::time::Duration::from_secs(600))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lit la liste des activités Strava sans fenêtre, une page toutes les 3 secondes. `complet` : toute la liste ; sinon seulement les pages récentes.
#[tauri::command]
async fn strava_synchroniser(app: AppHandle, complet: bool) -> Result<strava::Bilan, String> {
    let occupe = OccupeNavigateur::prendre()?;
    let (exe, profil) = (navigateur_choisi(&app)?, profil_strava(&app)?);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        let aujourdhui = nolio::aujourd_hui();
        let base = a.state::<Base>();
        let evenements = a.clone();
        strava::synchroniser(
            &exe,
            &profil,
            strava::ORIGINE,
            complet,
            strava::PAUSE_ENTRE_PAGES,
            &NAV_ANNULER,
            |acts| strava::enregistrer(&*verrou(base.inner())?, acts, &aujourdhui),
            |fait, total| {
                let _ = evenements.emit("strava-progression", Progression { recus: fait as u64, total: total as u64 });
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn nolio_annuler() {
    NAV_ANNULER.store(true, std::sync::atomic::Ordering::SeqCst);
}

// ---------- Mise à jour (fichier installé remplacé par une nouvelle version) ----------

static MAJ_EN_ATTENTE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Vrai si une nouvelle version a été posée par l'installeur depuis le lancement.
#[tauri::command]
fn maj_en_attente() -> bool {
    MAJ_EN_ATTENTE.load(std::sync::atomic::Ordering::SeqCst)
}

/// Relance l'appli sur le fichier installé (la nouvelle version), puis ferme celle-ci.
#[tauri::command]
fn maj_relancer(app: AppHandle) -> Result<(), String> {
    let chemin = maj::chemin_installe().ok_or("fichier de l'application introuvable")?;
    maj::lancer_nouvelle_instance(&chemin)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn db_infos(b: State<'_, Base>) -> Result<(String, String), String> {
    base::infos(&*verrou(b.inner())?)
}

/// `Foulee --mcp` : serveur MCP en lecture seule sur stdin/stdout, sans fenêtre ni Tauri. Rend le code de sortie du processus.
pub fn lancer_mcp() -> i32 {
    mcp::lancer()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Dossier de données propre à chaque système ; la clé vient du trousseau de l'OS.
            // Relancé par « Mettre à jour » : l'ancienne instance a un instant pour se fermer avant qu'on ouvre la base.
            std::thread::sleep(maj::attente_au_lancement());
            let dossier = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dossier)?;
            secrets::amorcer_depuis_env();
            let cle = secrets::cle_base()?;
            let conn = base::ouvrir(&dossier.join("foulee-chiffre.db"), &cle)?;
            app.manage(Base(Mutex::new(conn)));
            // En développement, le binaire est recompilé en permanence : pas de surveillance (FOULEE_SURVEILLER_MAJ=chemin pour l'essayer).
            let a_surveiller = std::env::var_os("FOULEE_SURVEILLER_MAJ").map(std::path::PathBuf::from).or_else(|| if cfg!(debug_assertions) { None } else { maj::chemin_installe() });
            if let Some(chemin) = a_surveiller {
                let a = app.handle().clone();
                maj::surveiller(chemin, std::time::Duration::from_secs(3), std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)), move || {
                    MAJ_EN_ATTENTE.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = a.emit("maj-disponible", ());
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_select, db_execute, db_batch, db_infos, secret_definir, secret_existe, secret_supprimer, navigateur_etat, navigateur_telecharger, navigateur_annuler, navigateur_tester, nolio_connecter, nolio_synchroniser, nolio_annuler, strava_connecter, strava_synchroniser, maj_en_attente, maj_relancer])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Foulée");
}

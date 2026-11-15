mod base;
mod garmin;
mod garmin_api;
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
/// Qui utilise le navigateur en ce moment (pour dire à celui qui attend de quoi il s'agit).
static NAV_PAR: std::sync::Mutex<&'static str> = std::sync::Mutex::new("");
static NAV_ANNULER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Une seule tâche du navigateur piloté à la fois (connexion ou synchronisation, Nolio ou Strava) : simple, et jamais deux fenêtres ouvertes.
struct OccupeNavigateur;
impl OccupeNavigateur {
    /// Prend le navigateur, en attendant son tour (10 minutes au plus) quand une autre lecture ou connexion utilise le navigateur :
    /// la demande passe juste après. À appeler hors du fil de l'interface. Une annulation demandée pendant l'attente l'arrête.
    fn attendre(app: &AppHandle, nom: &'static str) -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        let debut = std::time::Instant::now();
        let mut signale = false;
        let resultat = loop {
            if !NAV_OCCUPE.swap(true, Ordering::SeqCst) {
                NAV_ANNULER.store(false, Ordering::SeqCst);
                *NAV_PAR.lock().unwrap_or_else(|e| e.into_inner()) = nom;
                break Ok(OccupeNavigateur);
            }
            if !signale {
                // L'interface le dit seulement quand c'est vrai : « Nolio utilise le navigateur, Strava démarre juste après ».
                let par = *NAV_PAR.lock().unwrap_or_else(|e| e.into_inner());
                let _ = app.emit("navigateur-attente", Some(par));
                signale = true;
            }
            if NAV_ANNULER.load(Ordering::SeqCst) {
                break Err("annulé avant le début".to_string());
            }
            if debut.elapsed() > std::time::Duration::from_secs(600) {
                break Err("le navigateur est resté occupé trop longtemps : réessaie".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        };
        if signale {
            let _ = app.emit("navigateur-attente", None::<&str>);
        }
        resultat
    }
}
impl Drop for OccupeNavigateur {
    fn drop(&mut self) {
        NAV_OCCUPE.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

static GARMIN_OCCUPE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static GARMIN_ANNULER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Garmin ne passe pas par le navigateur : sa lecture a son propre verrou (une seule à la fois) et n'empêche ni Strava ni Nolio.
struct OccupeGarmin;
impl OccupeGarmin {
    fn prendre() -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        if GARMIN_OCCUPE.swap(true, Ordering::SeqCst) {
            return Err("Garmin est déjà en cours de lecture".into());
        }
        GARMIN_ANNULER.store(false, Ordering::SeqCst);
        Ok(OccupeGarmin)
    }
}
impl Drop for OccupeGarmin {
    fn drop(&mut self) {
        GARMIN_OCCUPE.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

fn profil_nolio(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(dossier_app(app)?.join("navigateur").join("profils").join("nolio"))
}

fn navigateur_choisi(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let nav = navigateur::choisir(&dossier_app(app)?).ok_or("aucun navigateur disponible : installe Chrome, Edge ou Chromium, ou télécharge Chrome for Testing")?;
    Ok(std::path::PathBuf::from(nav.chemin))
}

/// Connecte Nolio avec l'e-mail et le mot de passe saisis dans l'appli, dans le navigateur sans fenêtre. Rien n'est gardé : seule la session du profil reste.
#[tauri::command]
async fn nolio_connecter(app: AppHandle, email: String, mot_de_passe: String) -> Result<(), String> {
    if email.trim().is_empty() || mot_de_passe.is_empty() {
        return Err("saisis l'e-mail et le mot de passe de ton compte Nolio".into());
    }
    let (exe, profil) = (navigateur_choisi(&app)?, profil_nolio(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = OccupeNavigateur::attendre(&app, "Nolio")?;
        nolio::connecter(&exe, &profil, nolio::ORIGINE, email.trim(), &mot_de_passe, &NAV_ANNULER, std::time::Duration::from_secs(60))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lit le calendrier Nolio (35 jours passés, 200 à venir ; commentaires et structures jusqu'à 21 jours à venir) sans fenêtre.
/// Écrit le RPE d'une séance sur Nolio (option de l'utilisateur). La séance Nolio est retrouvée par sa date et son heure de départ.
#[tauri::command]
async fn nolio_envoyer_rpe(app: AppHandle, date: String, heure: Option<String>, rpe: i64) -> Result<(), String> {
    let (exe, profil) = (navigateur_choisi(&app)?, profil_nolio(&app)?);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let id = nolio::choisir_seance(&*verrou(a.state::<Base>().inner())?, &date, heure.as_deref())?;
        let _occupe = OccupeNavigateur::attendre(&a, "Nolio")?;
        nolio::ecrire_rpe(&exe, &profil, nolio::ORIGINE, id, rpe)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn nolio_synchroniser(app: AppHandle) -> Result<nolio::Bilan, String> {
    let (exe, profil) = (navigateur_choisi(&app)?, profil_nolio(&app)?);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = OccupeNavigateur::attendre(&a, "Nolio")?;
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

/// Connexion Strava commencée : le navigateur sans fenêtre attend le code reçu par e-mail. Garde aussi le verrou du navigateur jusqu'à la fin ou l'abandon.
static STRAVA_EN_ATTENTE: std::sync::Mutex<Option<(strava::Connexion, OccupeNavigateur)>> = std::sync::Mutex::new(None);

/// Connexion à Strava par e-mail et code à usage unique (Google refuse les navigateurs pilotés, donc pas de connexion Google). Saisit l'e-mail dans le
/// navigateur sans fenêtre et demande le code. Rend « ok » (session déjà valide) ou « code » : le code arrive par e-mail, à saisir avec `strava_code`.
#[tauri::command]
async fn strava_connecter(app: AppHandle, email: String) -> Result<String, String> {
    if email.trim().is_empty() || !email.contains('@') {
        return Err("saisis l'adresse e-mail de ton compte Strava".into());
    }
    // Une connexion déjà en attente est abandonnée avant d'en commencer une autre.
    strava_abandonner();
    let (exe, profil) = (navigateur_choisi(&app)?, profil_strava(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let occupe = OccupeNavigateur::attendre(&app, "Strava")?;
        let (connexion, etape) = strava::demarrer_connexion(&exe, &profil, strava::ORIGINE, email.trim(), true, &NAV_ANNULER, std::time::Duration::from_secs(60))?;
        match (connexion, etape) {
            (Some(c), strava::Etape::CodeRequis) => {
                *STRAVA_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())? = Some((c, occupe));
                Ok("code".to_string())
            }
            _ => Ok("ok".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Termine la connexion Strava avec le code reçu par e-mail. Un code refusé laisse la connexion en attente : on peut en ressaisir un.
#[tauri::command]
async fn strava_code(code: String) -> Result<(), String> {
    let en_attente = STRAVA_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())?.take();
    let Some((mut connexion, occupe)) = en_attente else {
        return Err("aucune connexion Strava en cours : recommence".into());
    };
    NAV_ANNULER.store(false, std::sync::atomic::Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || match strava::envoyer_code(&mut connexion, &code, &NAV_ANNULER, std::time::Duration::from_secs(45)) {
        Ok(()) => {
            connexion.fermer();
            drop(occupe);
            Ok(())
        }
        Err(e) => {
            if e == "connexion annulée" {
                connexion.fermer();
                drop(occupe);
            } else if let Ok(mut g) = STRAVA_EN_ATTENTE.lock() {
                *g = Some((connexion, occupe));
            }
            Err(e)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abandonne une connexion Strava en attente du code : ferme le navigateur et libère le verrou.
#[tauri::command]
fn strava_abandonner() {
    let pris = STRAVA_EN_ATTENTE.lock().ok().and_then(|mut g| g.take());
    if let Some((c, occupe)) = pris {
        c.fermer();
        drop(occupe);
    }
}

/// Lit la liste des activités Strava sans fenêtre, une page toutes les 3 secondes. `complet` : toute la liste ; sinon seulement les pages récentes.
#[tauri::command]
async fn strava_synchroniser(app: AppHandle, complet: bool) -> Result<strava::Bilan, String> {
    let (exe, profil) = (navigateur_choisi(&app)?, profil_strava(&app)?);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = OccupeNavigateur::attendre(&a, "Strava")?;
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

#[derive(Clone, serde::Serialize)]
struct ProgressionGarmin {
    etape: String,
    fait: u64,
    total: u64,
}

/// La connexion en cours quand Garmin a demandé un code de vérification : le client garde ses cookies jusqu'à la saisie du code.
static GARMIN_EN_ATTENTE: Mutex<Option<garmin_api::Client>> = Mutex::new(None);

fn jetons_garmin() -> Result<Option<garmin_api::Jetons>, String> {
    Ok(match (secrets::lire("garmin-oauth1-token")?, secrets::lire("garmin-oauth1-secret")?) {
        (Some(t), Some(s)) => Some(garmin_api::Jetons { oauth1_token: t, oauth1_secret: s }),
        _ => None,
    })
}

fn garder_jetons_garmin(client: &garmin_api::Client) -> Result<(), String> {
    let j = client.jetons().ok_or("Garmin n'a pas donné de jeton")?;
    secrets::definir("garmin-oauth1-token", &j.oauth1_token)?;
    secrets::definir("garmin-oauth1-secret", &j.oauth1_secret)
}

/// Connexion à Garmin avec l'e-mail et le mot de passe saisis dans l'appli (jamais gardés : seul le jeton va dans le trousseau).
/// Rend « ok », ou « code:email » (ou sms…) quand Garmin demande un code de vérification : l'appelant le saisit puis appelle `garmin_code`.
#[tauri::command]
async fn garmin_connecter(email: String, mot_de_passe: String) -> Result<String, String> {
    let occupe = OccupeGarmin::prendre()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        let mut client = garmin_api::Client::nouveau(garmin_api::Hotes::reels(), None)?;
        match client.connecter(email.trim(), &mot_de_passe)? {
            garmin_api::Connexion::Faite => {
                garder_jetons_garmin(&client)?;
                Ok("ok".to_string())
            }
            garmin_api::Connexion::CodeRequis(methode) => {
                *GARMIN_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())? = Some(client);
                Ok(format!("code:{methode}"))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Termine la connexion avec le code de vérification envoyé par Garmin.
#[tauri::command]
async fn garmin_code(code: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut client = GARMIN_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())?.take().ok_or("Aucune connexion en attente : recommence depuis le début")?;
        match client.verifier_code(code.trim()) {
            Ok(()) => garder_jetons_garmin(&client),
            Err(garmin_api::ErreurGarmin::Auth(m)) => {
                // Code refusé : on garde la connexion en attente pour permettre une nouvelle saisie.
                *GARMIN_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())? = Some(client);
                Err(m)
            }
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn garmin_connecte() -> Result<bool, String> {
    Ok(jetons_garmin()?.is_some())
}

/// Oublie la connexion Garmin : efface le jeton du trousseau.
#[tauri::command]
fn garmin_deconnecter() -> Result<(), String> {
    *GARMIN_EN_ATTENTE.lock().map_err(|_| "état de connexion verrouillé".to_string())? = None;
    secrets::supprimer("garmin-oauth1-token")?;
    secrets::supprimer("garmin-oauth1-secret")
}

/// Lit Garmin avec le jeton du trousseau : profil (prénom), activités, tours, santé du jour. `complet` : tout l'historique ; sinon les 20 dernières activités.
#[tauri::command]
async fn garmin_synchroniser(app: AppHandle, complet: bool) -> Result<garmin::Bilan, String> {
    let occupe = OccupeGarmin::prendre()?;
    let jetons = jetons_garmin()?.ok_or("Garmin n'est pas connecté : connecte-toi depuis Profil")?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _occupe = occupe;
        let mut client = garmin_api::Client::nouveau(garmin_api::Hotes::reels(), Some(jetons))?;
        let base = a.state::<Base>();
        let evenements = a.clone();
        garmin::synchroniser(
            &mut client,
            complet,
            std::time::Duration::from_millis(150),
            &GARMIN_ANNULER,
            |f| {
                let g = verrou(base.inner())?;
                f(&g)
            },
            |etape, fait, total| {
                let _ = evenements.emit("garmin-progression", ProgressionGarmin { etape: etape.to_string(), fait: fait as u64, total: total as u64 });
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn garmin_annuler() {
    GARMIN_ANNULER.store(true, std::sync::atomic::Ordering::SeqCst);
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
        .invoke_handler(tauri::generate_handler![db_select, db_execute, db_batch, db_infos, secret_definir, secret_existe, secret_supprimer, navigateur_etat, navigateur_telecharger, navigateur_annuler, navigateur_tester, nolio_connecter, nolio_synchroniser, nolio_envoyer_rpe, nolio_annuler, strava_connecter, strava_code, strava_abandonner, strava_synchroniser, garmin_connecter, garmin_code, garmin_connecte, garmin_deconnecter, garmin_synchroniser, garmin_annuler, maj_en_attente, maj_relancer])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Foulée");
}

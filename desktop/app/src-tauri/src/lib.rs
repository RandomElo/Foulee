mod base;
mod navigateur;
mod secrets;

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

#[tauri::command]
fn db_infos(b: State<'_, Base>) -> Result<(String, String), String> {
    base::infos(&*verrou(b.inner())?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Dossier de données propre à chaque système ; la clé vient du trousseau de l'OS.
            let dossier = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dossier)?;
            secrets::amorcer_depuis_env();
            let cle = secrets::cle_base()?;
            let conn = base::ouvrir(&dossier.join("foulee-chiffre.db"), &cle)?;
            app.manage(Base(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_select, db_execute, db_batch, db_infos, secret_definir, secret_existe, secret_supprimer, navigateur_etat, navigateur_telecharger, navigateur_annuler, navigateur_tester])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Foulée");
}

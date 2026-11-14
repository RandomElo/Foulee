mod base;
mod secrets;

use rusqlite::Connection;
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::{Manager, State};

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
        .invoke_handler(tauri::generate_handler![db_select, db_execute, db_batch, db_infos, secret_definir, secret_existe, secret_supprimer])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Foulée");
}

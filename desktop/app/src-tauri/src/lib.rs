use tauri_plugin_sql::{Migration, MigrationKind};

/// Migrations de la base locale. Une entrée par version, jamais modifiée après publication.
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "tables_de_base",
        sql: "CREATE TABLE IF NOT EXISTS reglages (
                cle TEXT PRIMARY KEY,
                valeur TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // La base vit dans le dossier de données de l'application, propre à chaque système.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:foulee.db", migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Foulée");
}

//! Base locale chiffrée (SQLCipher). Le webview n'ouvre jamais le fichier : il passe par les
//! commandes `db_select` et `db_execute`, la clé reste côté Rust (trousseau de l'OS).

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value as Json};
use std::path::Path;

/// Une entrée par version, jamais modifiée après publication.
pub(crate) const MIGRATIONS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);",
    // 2 : séances, tours, corrections de rôle, santé du jour, ressenti
    "CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        start_local TEXT NOT NULL,
        type TEXT NOT NULL,
        distance REAL, duration REAL, avg_speed REAL, avg_hr REAL, max_hr REAL,
        training_load REAL, name TEXT NOT NULL DEFAULT '', elevation REAL,
        manual_category TEXT, trimp REAL,
        UNIQUE (source, external_id)
     );
     CREATE INDEX activities_start ON activities (start_local);
     CREATE TABLE laps (
        activity_id INTEGER NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        distance REAL, duration REAL, avg_speed REAL, avg_hr REAL, max_hr REAL,
        elevation_gain REAL, intensity_type TEXT, step_index INTEGER,
        PRIMARY KEY (activity_id, idx)
     );
     CREATE TABLE lap_roles (
        activity_id INTEGER NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('WARMUP', 'WORK', 'RECOVERY', 'COOLDOWN', 'OTHER')),
        PRIMARY KEY (activity_id, idx)
     );
     CREATE TABLE daily (
        date TEXT PRIMARY KEY,
        resting_hr REAL, avg_stress REAL, body_battery_high REAL,
        sleep_seconds REAL, sleep_score REAL, hrv_night REAL, steps REAL
     );
     CREATE TABLE feelings (
        activity_id INTEGER PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
        form INTEGER, legs INTEGER, motivation INTEGER, pain INTEGER, note TEXT,
        answered_at TEXT NOT NULL
     );",
    // 3 : effort perçu (RPE, 1 à 10)
    "ALTER TABLE feelings ADD COLUMN rpe INTEGER CHECK (rpe BETWEEN 1 AND 10);",
    // 4 : calendrier Nolio lu par le navigateur piloté (séances prévues et réalisées, compétitions, notes)
    "CREATE TABLE nolio_evenements (
        id TEXT PRIMARY KEY,
        genre TEXT NOT NULL CHECK (genre IN ('prevu', 'reel', 'note')),
        competition INTEGER NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        heure TEXT,
        titre TEXT NOT NULL DEFAULT '',
        sport TEXT,
        duree_s INTEGER,
        distance_m REAL,
        deniv_m REAL,
        allure_s_km INTEGER,
        allure_plafond INTEGER NOT NULL DEFAULT 0,
        rpe_prevu INTEGER,
        ressenti INTEGER,
        rpe_percu INTEGER,
        commentaire TEXT,
        structure TEXT,
        lu_le TEXT NOT NULL
     );
     CREATE INDEX nolio_evenements_date ON nolio_evenements (date);",
    // 5 : activités Strava lues par le navigateur piloté (nom, description, labels), rapprochées des séances par l'heure de départ
    "CREATE TABLE strava_activites (
        id TEXT PRIMARY KEY,
        sport TEXT NOT NULL,
        nom TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        labels TEXT NOT NULL DEFAULT '',
        debut TEXT NOT NULL,
        debut_local TEXT NOT NULL,
        duree_totale_s INTEGER NOT NULL DEFAULT 0,
        duree_mouvement_s INTEGER,
        distance_m REAL,
        denivele_m REAL,
        lu_le TEXT NOT NULL
     );
     CREATE INDEX strava_activites_debut_local ON strava_activites (debut_local);",
];

/// Ouvre (ou crée) la base chiffrée avec une clé de 32 octets en hexadécimale, puis joue les migrations.
pub fn ouvrir(chemin: &Path, cle_hex: &str) -> Result<Connection, String> {
    if cle_hex.len() != 64 || !cle_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("clé de base invalide".into());
    }
    let conn = Connection::open(chemin).map_err(|e| format!("ouverture de la base : {e}"))?;
    // Clé brute (x'..'), pas de dérivation à partir d'un mot de passe : elle est aléatoire.
    conn.pragma_update(None, "key", format!("x'{cle_hex}'"))
        .map_err(|e| format!("clé refusée : {e}"))?;
    // Premier accès : échoue ici si la clé ne correspond pas au fichier.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "base illisible : mauvaise clé ou fichier corrompu".to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    migrer(&conn)?;
    Ok(conn)
}

/// Ouvre la base chiffrée en lecture seule, sans jouer les migrations (le serveur MCP ne doit jamais rien écrire, ni créer un fichier).
pub fn ouvrir_lecture(chemin: &Path, cle_hex: &str) -> Result<Connection, String> {
    if cle_hex.len() != 64 || !cle_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("clé de base invalide".into());
    }
    let conn = Connection::open_with_flags(chemin, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| format!("ouverture de la base : {e}"))?;
    conn.pragma_update(None, "key", format!("x'{cle_hex}'")).map_err(|e| format!("clé refusée : {e}"))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).map_err(|_| "base illisible : mauvaise clé ou fichier corrompu".to_string())?;
    Ok(conn)
}

fn migrer(conn: &Connection) -> Result<(), String> {
    let actuelle: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(actuelle as usize) {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| format!("migration {} : {e}", i + 1))?;
        tx.pragma_update(None, "user_version", (i + 1) as i64).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn vers_sql(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("nombre invalide")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        _ => return Err("paramètre de type non géré (objet ou tableau)".into()),
    })
}

pub fn selectionner(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
    let valeurs = params.iter().map(vers_sql).collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let noms: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(valeurs)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut m = Map::new();
        for (i, nom) in noms.iter().enumerate() {
            let v = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Json::Null,
                ValueRef::Integer(n) => Json::from(n),
                ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
                ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => return Err("colonne binaire non gérée".into()),
            };
            m.insert(nom.clone(), v);
        }
        out.push(m);
    }
    Ok(out)
}

pub fn executer(conn: &Connection, sql: &str, params: &[Json]) -> Result<usize, String> {
    let valeurs = params.iter().map(vers_sql).collect::<Result<Vec<_>, _>>()?;
    conn.execute(sql, params_from_iter(valeurs)).map_err(|e| e.to_string())
}

/// Plusieurs écritures en une seule transaction : tout passe ou rien (import, synchro).
pub fn executer_lot(conn: &Connection, lot: &[(String, Vec<Json>)]) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut total = 0;
    for (sql, params) in lot {
        let valeurs = params.iter().map(vers_sql).collect::<Result<Vec<_>, _>>()?;
        total += tx.execute(sql, params_from_iter(valeurs)).map_err(|e| format!("{e} (requête : {sql})"))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(total)
}

/// Versions de SQLite et de SQLCipher : prouve que le chiffrement est bien actif.
pub fn infos(conn: &Connection) -> Result<(String, String), String> {
    let sqlite: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let cipher: String = conn.query_row("PRAGMA cipher_version", [], |r| r.get(0)).map_err(|_| "SQLCipher absent : base non chiffrée".to_string())?;
    Ok((sqlite, cipher))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const CLE_A: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const CLE_B: &str = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

    fn chemin(nom: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("foulee-test-{}-{nom}.db", std::process::id()));
        let _ = fs::remove_file(&p);
        p
    }

    #[test]
    fn la_base_est_chiffree_et_relisible_avec_la_bonne_cle() {
        let p = chemin("a");
        {
            let c = ouvrir(&p, CLE_A).unwrap();
            executer(&c, "INSERT INTO reglages (cle, valeur) VALUES (?, ?)", &[Json::from("secret"), Json::from("valeur-en-clair-test")]).unwrap();
            let (_, cipher) = infos(&c).unwrap();
            assert!(!cipher.is_empty());
        }
        let octets = fs::read(&p).unwrap();
        assert!(!octets.starts_with(b"SQLite format 3"), "l'en-tête SQLite ne doit pas être lisible");
        assert!(!String::from_utf8_lossy(&octets).contains("valeur-en-clair-test"), "le contenu ne doit pas apparaître en clair");
        let c = ouvrir(&p, CLE_A).unwrap();
        let rows = selectionner(&c, "SELECT valeur FROM reglages WHERE cle = ?", &[Json::from("secret")]).unwrap();
        assert_eq!(rows[0]["valeur"], Json::from("valeur-en-clair-test"));
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn une_mauvaise_cle_est_refusee() {
        let p = chemin("b");
        ouvrir(&p, CLE_A).unwrap();
        assert!(ouvrir(&p, CLE_B).is_err());
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn un_lot_est_atomique_et_les_tables_de_seances_existent() {
        let p = chemin("e");
        let c = ouvrir(&p, CLE_A).unwrap();
        let ok = vec![
            ("INSERT INTO activities (source, external_id, start_local, type) VALUES (?, ?, ?, ?)".to_string(), vec![Json::from("garmin"), Json::from("1"), Json::from("2026-11-01 08:00:00"), Json::from("running")]),
            ("INSERT INTO laps (activity_id, idx, distance, duration) VALUES (1, 0, 1000.0, 300.0)".to_string(), vec![]),
        ];
        assert_eq!(executer_lot(&c, &ok).unwrap(), 2);
        // Le second ordre est invalide (clé étrangère inexistante) : le premier doit être annulé aussi.
        let ko = vec![
            ("INSERT INTO activities (source, external_id, start_local, type) VALUES ('garmin', '2', '2026-11-02 08:00:00', 'running')".to_string(), vec![]),
            ("INSERT INTO laps (activity_id, idx) VALUES (999, 0)".to_string(), vec![]),
        ];
        assert!(executer_lot(&c, &ko).is_err());
        let n = selectionner(&c, "SELECT count(*) AS n FROM activities", &[]).unwrap();
        assert_eq!(n[0]["n"], Json::from(1));
        // Suppression en cascade : les tours partent avec la séance.
        executer(&c, "DELETE FROM activities WHERE id = 1", &[]).unwrap();
        let l = selectionner(&c, "SELECT count(*) AS n FROM laps", &[]).unwrap();
        assert_eq!(l[0]["n"], Json::from(0));
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn une_base_deja_a_la_version_1_monte_a_la_derniere() {
        let p = chemin("f");
        {
            // Comme la base de dev d'avant : seule la migration 1 est jouée.
            let c = Connection::open(&p).unwrap();
            c.pragma_update(None, "key", format!("x'{CLE_A}'")).unwrap();
            c.execute_batch(MIGRATIONS[0]).unwrap();
            c.execute("INSERT INTO reglages (cle, valeur) VALUES ('garde', 'oui')", []).unwrap();
            c.pragma_update(None, "user_version", 1i64).unwrap();
        }
        let c = ouvrir(&p, CLE_A).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        let r = selectionner(&c, "SELECT valeur FROM reglages WHERE cle = 'garde'", &[]).unwrap();
        assert_eq!(r[0]["valeur"], Json::from("oui"), "les données existantes doivent survivre à la migration");
        assert!(selectionner(&c, "SELECT count(*) AS n FROM feelings", &[]).is_ok());
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn le_rpe_doit_etre_entre_1_et_10() {
        let p = chemin("g");
        let c = ouvrir(&p, CLE_A).unwrap();
        executer(&c, "INSERT INTO activities (source, external_id, start_local, type) VALUES ('demo', '1', '2026-11-01 08:00:00', 'running')", &[]).unwrap();
        assert!(executer(&c, "INSERT INTO feelings (activity_id, rpe, answered_at) VALUES (1, 11, 'x')", &[]).is_err());
        assert!(executer(&c, "INSERT INTO feelings (activity_id, rpe, answered_at) VALUES (1, 0, 'x')", &[]).is_err());
        assert!(executer(&c, "INSERT INTO feelings (activity_id, rpe, answered_at) VALUES (1, 7, 'x')", &[]).is_ok());
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn une_cle_mal_formee_est_refusee() {
        assert!(ouvrir(&chemin("c"), "trop-courte").is_err());
    }

    #[test]
    fn les_migrations_ne_sont_jouees_qu_une_fois() {
        let p = chemin("d");
        ouvrir(&p, CLE_A).unwrap();
        let c = ouvrir(&p, CLE_A).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        let _ = fs::remove_file(&p);
    }
}

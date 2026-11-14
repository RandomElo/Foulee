//! Base locale chiffrée (SQLCipher). Le webview n'ouvre jamais le fichier : il passe par les
//! commandes `db_select` et `db_execute`, la clé reste côté Rust (trousseau de l'OS).

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value as Json};
use std::path::Path;

/// Une entrée par version, jamais modifiée après publication.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);",
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

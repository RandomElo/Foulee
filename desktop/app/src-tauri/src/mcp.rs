//! Serveur MCP local (protocole Model Context Protocol, JSON-RPC 2.0 sur stdin/stdout) : `Foulee.AppImage --mcp`. Il permet à Claude, Codex
//! ou Copilot de lire les séances et le calendrier, en LECTURE SEULE : la base est ouverte en lecture seule avec la clé du trousseau, aucun outil
//! n'écrit, aucune donnée ne sort de l'ordinateur sauf ce que le client demande. Pas de trace GPS, pas d'identifiants, pas de mot de passe.
//!
//! Les noms et commentaires de séance sont gardés (l'utilisateur le veut) mais les adresses e-mail, numéros de téléphone et liens y sont masqués.

use rusqlite::{types::ValueRef, Connection};
use serde_json::{json, Map, Value};
use std::io::{BufRead, Write};

const VERSION_PROTOCOLE: &str = "2024-11-05";
const MAX_LIGNES: i64 = 200;

/// Masque les numéros de téléphone écrits par groupes (« 06 12 34 56 78 », « +33 6 12 34 56 78 ») : une suite de chiffres, espaces, points et tirets qui
/// commence par 0 ou + et compte 9 à 15 chiffres. Les suites d'allures ou de distances (« 1000 800 600 400 ») ne commencent pas ainsi et restent.
fn masquer_telephones(texte: &str) -> String {
    let c: Vec<char> = texte.chars().collect();
    let mut sortie = String::new();
    let mut i = 0;
    while i < c.len() {
        if c[i] == '+' || c[i] == '0' {
            let mut j = i;
            while j < c.len() && (c[j].is_ascii_digit() || matches!(c[j], ' ' | '.' | '-' | '+')) {
                j += 1;
            }
            // Ne garde pas les espaces et signes de fin dans le numéro.
            while j > i && !c[j - 1].is_ascii_digit() {
                j -= 1;
            }
            let chiffres = c[i..j].iter().filter(|x| x.is_ascii_digit()).count();
            let colle_a_un_mot = i > 0 && c[i - 1].is_alphanumeric();
            if !colle_a_un_mot && (9..=15).contains(&chiffres) {
                sortie.push_str("[téléphone]");
                i = j;
                continue;
            }
        }
        sortie.push(c[i]);
        i += 1;
    }
    sortie
}

/// Masque ce qui ressemble à un e-mail, un numéro de téléphone ou un lien dans un texte libre (nom ou commentaire de séance).
pub fn masquer(texte: &str) -> String {
    let mots: String = texte
        .split_inclusive(char::is_whitespace)
        .map(|m| {
            let mot = m.trim_end();
            let reste = &m[mot.len()..];
            let nu = mot.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '+');
            if nu.contains('@') && nu.contains('.') {
                format!("[e-mail]{reste}")
            } else if nu.starts_with("http://") || nu.starts_with("https://") || nu.starts_with("www.") {
                format!("[lien]{reste}")
            } else {
                m.to_string()
            }
        })
        .collect();
    masquer_telephones(&mots)
}

fn texte(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!((f * 100.0).round() / 100.0),
        ValueRef::Text(t) => Value::String(masquer(&String::from_utf8_lossy(t))),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn lignes(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<Value>, String> {
    let mut st = conn.prepare(sql).map_err(|e| e.to_string())?;
    let noms: Vec<String> = st.column_names().into_iter().map(|s| s.to_string()).collect();
    let rows = st
        .query_map(params, |r| {
            let mut o = Map::new();
            for (i, n) in noms.iter().enumerate() {
                o.insert(n.clone(), texte(r.get_ref(i)?));
            }
            Ok(Value::Object(o))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn entier(args: &Value, cle: &str, defaut: i64, min: i64, max: i64) -> i64 {
    args.get(cle).and_then(Value::as_i64).unwrap_or(defaut).clamp(min, max)
}

/// Les outils : tous en lecture seule.
fn outils() -> Value {
    json!([
        { "name": "seances_recentes", "description": "Séances de course et autres activités des derniers jours (date, type, titre, distance en m, durée en s, allure, FC, charge).",
          "inputSchema": { "type": "object", "properties": { "jours": { "type": "integer", "description": "Fenêtre en jours (1 à 120, défaut 14)" } } } },
        { "name": "seance", "description": "Une séance par son identifiant : chiffres, tours de la montre (distance, durée, FC) et ressenti saisi par l'utilisateur (effort perçu 1 à 10, jambes, douleur, note).",
          "inputSchema": { "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] } },
        { "name": "nolio_calendrier", "description": "Calendrier Nolio (séances prévues par le coach, compétitions) pour les prochains jours. allure_plafond vaut 1 quand l'allure prévue est une limite à ne pas dépasser (footing), pas une cible.",
          "inputSchema": { "type": "object", "properties": { "jours": { "type": "integer", "description": "Jours à venir (1 à 120, défaut 14)" } } } },
        { "name": "sante", "description": "Santé du jour lue sur la montre, un jour par ligne : FC au repos (bpm), stress moyen, Body Battery maximale, sommeil (s), score de sommeil, VFC de la nuit (ms), pas. Une valeur absente veut dire que la montre ne l'a pas donnée.",
          "inputSchema": { "type": "object", "properties": { "jours": { "type": "integer", "description": "Fenêtre en jours (1 à 120, défaut 14)" } } } },
        { "name": "ressentis", "description": "Ressentis saisis par l'utilisateur après ses séances, avec le jour et le titre de la séance : effort perçu (1 à 10), jambes (1 lourdes, 2 normales, 3 légères), douleur (0 aucune, 1 légère, 2 gênante), note.",
          "inputSchema": { "type": "object", "properties": { "jours": { "type": "integer", "description": "Fenêtre en jours (1 à 120, défaut 28)" } } } }
    ])
}

fn appeler(conn: &Connection, nom: &str, args: &Value) -> Result<Value, String> {
    let aujourdhui = crate::nolio::aujourd_hui();
    match nom {
        "seances_recentes" => {
            let depuis = crate::nolio::decaler(&aujourdhui, -entier(args, "jours", 14, 1, 120))?;
            Ok(Value::Array(lignes(
                conn,
                &format!("SELECT id, substr(start_local,1,10) AS date, substr(start_local,12,5) AS heure, type, name AS titre, distance AS distance_m, duration AS duree_s, avg_speed AS vitesse_ms, avg_hr AS fc_moyenne, training_load AS charge, manual_category AS categorie FROM activities WHERE substr(start_local,1,10) >= ?1 ORDER BY start_local DESC LIMIT {MAX_LIGNES}"),
                &[&depuis],
            )?))
        }
        "seance" => {
            let id = args.get("id").and_then(Value::as_i64).ok_or("paramètre id manquant")?;
            let seance = lignes(conn, "SELECT id, start_local AS debut, type, name AS titre, distance AS distance_m, duration AS duree_s, avg_speed AS vitesse_ms, avg_hr AS fc_moyenne, max_hr AS fc_max, training_load AS charge, elevation AS denivele_m FROM activities WHERE id = ?1", &[&id])?;
            let Some(s) = seance.into_iter().next() else { return Err(format!("séance {id} introuvable")) };
            let tours = lignes(conn, "SELECT idx, distance AS distance_m, duration AS duree_s, avg_hr AS fc_moyenne FROM laps WHERE activity_id = ?1 ORDER BY idx", &[&id])?;
            let ressenti = lignes(conn, "SELECT rpe, legs AS jambes, pain AS douleur, note FROM feelings WHERE activity_id = ?1", &[&id])?;
            Ok(json!({ "seance": s, "tours": tours, "ressenti": ressenti.into_iter().next() }))
        }
        "nolio_calendrier" => {
            let fin = crate::nolio::decaler(&aujourdhui, entier(args, "jours", 14, 1, 120))?;
            Ok(Value::Array(lignes(
                conn,
                &format!("SELECT date, titre, sport, competition, duree_s, distance_m, allure_s_km, allure_plafond, rpe_prevu AS effort_estime_coach, commentaire AS mot_du_coach FROM nolio_evenements WHERE genre = 'prevu' AND date >= ?1 AND date <= ?2 ORDER BY date, id LIMIT {MAX_LIGNES}"),
                &[&aujourdhui, &fin],
            )?))
        }
        "sante" => {
            let depuis = crate::nolio::decaler(&aujourdhui, -entier(args, "jours", 14, 1, 120))?;
            Ok(Value::Array(lignes(
                conn,
                &format!("SELECT date, resting_hr AS fc_repos, avg_stress AS stress, body_battery_high AS body_battery_max, sleep_seconds AS sommeil_s, sleep_score AS score_sommeil, hrv_night AS vfc_nuit_ms, steps AS pas FROM daily WHERE date >= ?1 ORDER BY date DESC LIMIT {MAX_LIGNES}"),
                &[&depuis],
            )?))
        }
        "ressentis" => {
            let depuis = crate::nolio::decaler(&aujourdhui, -entier(args, "jours", 28, 1, 120))?;
            Ok(Value::Array(lignes(
                conn,
                &format!("SELECT substr(a.start_local,1,10) AS date, a.name AS titre, f.rpe, f.legs AS jambes, f.pain AS douleur, f.note FROM feelings f JOIN activities a ON a.id = f.activity_id WHERE substr(a.start_local,1,10) >= ?1 ORDER BY a.start_local DESC LIMIT {MAX_LIGNES}"),
                &[&depuis],
            )?))
        }
        autre => Err(format!("outil inconnu : {autre}")),
    }
}

fn erreur(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Traite un message JSON-RPC. Rend la réponse, ou rien pour une notification.
pub fn traiter(conn: &Connection, requete: &Value) -> Option<Value> {
    let id = requete.get("id").cloned();
    let methode = requete.get("method").and_then(Value::as_str);
    let Some(methode) = methode else {
        return id.map(|i| erreur(&i, -32600, "requête invalide"));
    };
    // Une notification (pas d'id) n'a jamais de réponse.
    let id = id?;
    Some(match methode {
        "initialize" => json!({ "jsonrpc": "2.0", "id": id, "result": {
            "protocolVersion": requete["params"]["protocolVersion"].as_str().unwrap_or(VERSION_PROTOCOLE),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "foulee", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Données d'entraînement de course à pied de l'utilisateur, en lecture seule. Les allures prévues marquées allure_plafond sont des limites, pas des cibles."
        } }),
        "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": outils() } }),
        "tools/call" => {
            let nom = requete["params"]["name"].as_str().unwrap_or("");
            let args = requete["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            match appeler(conn, nom, &args) {
                Ok(v) => json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": serde_json::to_string(&v).unwrap_or_default() }] } }),
                // Une erreur d'outil est un résultat marqué isError : le modèle la lit et peut corriger sa demande.
                Err(m) => json!({ "jsonrpc": "2.0", "id": id, "result": { "isError": true, "content": [{ "type": "text", "text": m }] } }),
            }
        }
        autre => erreur(&id, -32601, &format!("méthode inconnue : {autre}")),
    })
}

/// Boucle stdin → stdout, un message JSON par ligne.
pub fn servir(conn: &Connection, entree: impl BufRead, mut sortie: impl Write) -> std::io::Result<()> {
    for ligne in entree.lines() {
        let ligne = ligne?;
        if ligne.trim().is_empty() {
            continue;
        }
        let reponse = match serde_json::from_str::<Value>(&ligne) {
            Ok(v) if v.is_array() => Some(erreur(&Value::Null, -32600, "les lots ne sont pas gérés")),
            Ok(v) => traiter(conn, &v),
            Err(_) => Some(erreur(&Value::Null, -32700, "JSON illisible")),
        };
        if let Some(r) = reponse {
            writeln!(sortie, "{r}")?;
            sortie.flush()?;
        }
    }
    Ok(())
}

/// Dossier de données de l'appli (le même que Tauri), sans démarrer Tauri.
pub fn dossier_donnees() -> Result<std::path::PathBuf, String> {
    let id = "fr.foulee.desktop";
    #[cfg(target_os = "linux")]
    let base = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()).map(std::path::PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")));
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Library/Application Support"));
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(std::path::PathBuf::from);
    base.map(|b| b.join(id)).ok_or_else(|| "dossier de données introuvable".to_string())
}

/// Point d'entrée de `--mcp` : ouvre la base en lecture seule et sert sur stdin/stdout. Les messages d'état vont sur stderr, jamais sur stdout.
pub fn lancer() -> i32 {
    let ouverture = (|| {
        let chemin = dossier_donnees()?.join("foulee-chiffre.db");
        if !chemin.exists() {
            return Err("aucune base trouvée : ouvre Foulée une première fois".to_string());
        }
        crate::base::ouvrir_lecture(&chemin, &crate::secrets::cle_existante()?)
    })();
    match ouverture {
        Ok(conn) => match servir(&conn, std::io::stdin().lock(), std::io::stdout().lock()) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("foulee --mcp : {e}");
                1
            }
        },
        Err(e) => {
            eprintln!("foulee --mcp : {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        for m in crate::base::MIGRATIONS {
            c.execute_batch(m).unwrap();
        }
        let aujourdhui = crate::nolio::aujourd_hui();
        let hier = crate::nolio::decaler(&aujourdhui, -1).unwrap();
        let ancien = crate::nolio::decaler(&aujourdhui, -60).unwrap();
        let demain = crate::nolio::decaler(&aujourdhui, 1).unwrap();
        c.execute("INSERT INTO activities (id, source, external_id, start_local, type, distance, duration, avg_speed, avg_hr, name) VALUES (1,'garmin','1',?1,'running',10000,3000,3.33,150,'Footing avec jean@example.com au 06 12 34 56 78')", [format!("{hier}T07:29:00")]).unwrap();
        c.execute("INSERT INTO activities (id, source, external_id, start_local, type, distance, duration) VALUES (2,'garmin','2',?1,'running',5000,1500)", [format!("{ancien}T07:00:00")]).unwrap();
        c.execute("INSERT INTO laps (activity_id, idx, distance, duration, avg_hr) VALUES (1,0,1000,300,148)", []).unwrap();
        c.execute("INSERT INTO feelings (activity_id, rpe, legs, pain, note, answered_at) VALUES (1,5,2,0,'ok','x')", []).unwrap();
        c.execute("INSERT INTO daily (date, resting_hr, sleep_seconds, hrv_night) VALUES (?1, 49, 27000, 62)", [&hier]).unwrap();
        c.execute("INSERT INTO daily (date, resting_hr) VALUES (?1, 55)", [&ancien]).unwrap();
        c.execute("INSERT INTO nolio_evenements (id, genre, competition, date, titre, sport, duree_s, allure_s_km, allure_plafond, rpe_prevu, commentaire, lu_le) VALUES ('tp-1','prevu',0,?1,'Footing','Running',2700,295,1,2,'Facile, voir https://exemple.fr/x','x')", [demain]).unwrap();
        c.execute("INSERT INTO nolio_evenements (id, genre, competition, date, titre, lu_le) VALUES ('t-1','reel',0,?1,'Réalisé','x')", [crate::nolio::aujourd_hui()]).unwrap();
        c
    }

    fn appel(c: &Connection, requete: Value) -> Value {
        traiter(c, &requete).expect("une réponse était attendue")
    }

    fn contenu(r: &Value) -> Value {
        serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn le_masquage_cache_les_coordonnees_et_garde_le_reste() {
        assert_eq!(masquer("Footing avec jean@example.com au 06 12 34 56 78"), "Footing avec [e-mail] au [téléphone]");
        assert_eq!(masquer("tel +33 6 12 34 56 78, merci"), "tel [téléphone], merci");
        assert_eq!(masquer("0612345678"), "[téléphone]");
        // Des suites de distances ou d'allures ne sont pas des numéros.
        assert_eq!(masquer("1000 800 600 400 200 puis 3'55"), "1000 800 600 400 200 puis 3'55");
        assert_eq!(masquer("6x400 + 2000, récup 1'30 puis 0 à 10"), "6x400 + 2000, récup 1'30 puis 0 à 10");
        assert_eq!(masquer("voir https://exemple.fr/x demain"), "voir [lien] demain");
        assert_eq!(masquer("appelle +33612345678"), "appelle [téléphone]");
        assert_eq!(masquer("6x400 + 2000 à 3'55"), "6x400 + 2000 à 3'55");
        assert_eq!(masquer("Semi de Paris, 21,1 km"), "Semi de Paris, 21,1 km");
        assert_eq!(masquer(""), "");
    }

    #[test]
    fn la_poignee_de_main_et_la_liste_des_outils() {
        let c = base();
        let r = appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }));
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "foulee");
        let l = appel(&c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
        let noms: Vec<&str> = l["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(noms, ["seances_recentes", "seance", "nolio_calendrier", "sante", "ressentis"]);
        assert_eq!(appel(&c, json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }))["result"], json!({}));
        // Une notification n'a pas de réponse.
        assert!(traiter(&c, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
    }

    #[test]
    fn les_seances_recentes_respectent_la_fenetre_et_masquent_les_coordonnees() {
        let c = base();
        let r = appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "seances_recentes", "arguments": { "jours": 14 } } }));
        let l = contenu(&r);
        assert_eq!(l.as_array().unwrap().len(), 1, "la séance d'il y a 60 jours est hors fenêtre");
        let titre = l[0]["titre"].as_str().unwrap();
        assert!(titre.contains("[e-mail]") && !titre.contains("jean@"), "{titre}");
        assert_eq!(l[0]["distance_m"].as_f64(), Some(10000.0));
        let large = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "seances_recentes", "arguments": { "jours": 9999 } } })));
        assert_eq!(large.as_array().unwrap().len(), 2, "la fenêtre est bornée à 120 jours, la séance de 60 jours entre");
    }

    #[test]
    fn une_seance_donne_ses_tours_et_son_ressenti() {
        let c = base();
        let d = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "seance", "arguments": { "id": 1 } } })));
        assert_eq!(d["tours"].as_array().unwrap().len(), 1);
        assert_eq!(d["ressenti"]["rpe"], 5);
        assert_eq!(d["seance"]["fc_moyenne"].as_f64(), Some(150.0));
        let r = appel(&c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "seance", "arguments": { "id": 999 } } }));
        assert_eq!(r["result"]["isError"], true);
        let r = appel(&c, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "seance", "arguments": {} } }));
        assert_eq!(r["result"]["isError"], true);
    }

    #[test]
    fn la_sante_et_les_ressentis_respectent_la_fenetre_et_masquent_les_textes() {
        let c = base();
        let s = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "sante", "arguments": { "jours": 7 } } })));
        let l = s.as_array().unwrap();
        assert_eq!(l.len(), 1, "le jour d'il y a 60 jours est hors fenêtre");
        assert_eq!((l[0]["fc_repos"].as_f64(), l[0]["sommeil_s"].as_f64(), l[0]["vfc_nuit_ms"].as_f64()), (Some(49.0), Some(27000.0), Some(62.0)));
        assert!(l[0]["stress"].is_null(), "une valeur absente reste absente");
        let large = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "sante", "arguments": { "jours": 9999 } } })));
        assert_eq!(large.as_array().unwrap().len(), 2);
        let r = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "ressentis", "arguments": {} } })));
        let a = r.as_array().unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!((a[0]["rpe"].as_i64(), a[0]["jambes"].as_i64(), a[0]["note"].as_str()), (Some(5), Some(2), Some("ok")));
        assert!(a[0]["titre"].as_str().unwrap().contains("[e-mail]"), "le titre de la séance est masqué comme ailleurs");
    }

    #[test]
    fn le_calendrier_nolio_ne_donne_que_le_prevu_a_venir_avec_la_limite_d_allure() {
        let c = base();
        let l = contenu(&appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "nolio_calendrier", "arguments": {} } })));
        let a = l.as_array().unwrap();
        assert_eq!(a.len(), 1, "le réalisé n'est pas du prévu");
        assert_eq!(a[0]["allure_plafond"], 1);
        assert_eq!(a[0]["allure_s_km"], 295);
        assert!(a[0]["mot_du_coach"].as_str().unwrap().contains("[lien]"));
    }

    #[test]
    fn les_erreurs_de_protocole_sont_propres_et_rien_ne_s_ecrit() {
        let c = base();
        assert_eq!(appel(&c, json!({ "jsonrpc": "2.0", "id": 1, "method": "n/existe/pas" }))["error"]["code"], -32601);
        let r = appel(&c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "supprimer_tout" } }));
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(appel(&c, json!({ "jsonrpc": "2.0", "id": 3, "params": {} }))["error"]["code"], -32600);
        // Aucun outil n'est capable d'écrire : la liste ne contient que des lectures.
        let l = appel(&c, json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }));
        assert!(l["result"]["tools"].as_array().unwrap().iter().all(|t| !t["name"].as_str().unwrap().contains("ecri") && !t["name"].as_str().unwrap().contains("supprim")));
        let n: i64 = c.query_row("SELECT count(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn la_boucle_repond_ligne_par_ligne_et_survit_a_un_json_casse() {
        let c = base();
        let entree = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\nn'importe quoi\n\n[{\"id\":1}]\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n";
        let mut sortie = Vec::new();
        servir(&c, entree.as_bytes(), &mut sortie).unwrap();
        let lignes: Vec<Value> = String::from_utf8(sortie).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lignes.len(), 4, "ping, json cassé, lot refusé, ping : la notification et la ligne vide ne répondent pas");
        assert_eq!(lignes[0]["id"], 1);
        assert_eq!(lignes[1]["error"]["code"], -32700);
        assert_eq!(lignes[2]["error"]["code"], -32600);
        assert_eq!(lignes[3]["id"], 2);
    }

    #[test]
    fn la_base_ouverte_en_lecture_seule_refuse_d_ecrire() {
        let d = std::env::temp_dir().join(format!("foulee-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let chemin = d.join("t.db");
        let cle = "ab".repeat(32);
        drop(crate::base::ouvrir(&chemin, &cle).unwrap());
        let ro = crate::base::ouvrir_lecture(&chemin, &cle).unwrap();
        assert!(ro.execute("INSERT INTO reglages (cle, valeur) VALUES ('a','b')", []).is_err());
        assert!(crate::base::ouvrir_lecture(&chemin, &"cd".repeat(32)).is_err(), "mauvaise clé refusée");
        assert!(crate::base::ouvrir_lecture(&d.join("absent.db"), &cle).is_err(), "le serveur ne crée jamais de base");
        let _ = std::fs::remove_dir_all(&d);
    }
}

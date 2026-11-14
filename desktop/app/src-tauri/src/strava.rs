//! Lecteur Strava par le navigateur piloté (lecture seule). L'API de Strava est fermée aux comptes gratuits : comme pour Nolio, l'utilisateur
//! se connecte lui-même dans une vraie fenêtre, puis la liste de l'entraînement (nom, description, labels, sport, départ, durées, distance,
//! dénivelé) est lue avec la requête que la page « Entraînement » de Strava fait elle-même, depuis la page connectée, à faible cadence.
//!
//! Les conditions d'utilisation de Strava interdisent l'accès automatisé : usage limité au compte de l'utilisateur, une page toutes les 3 secondes,
//! jamais de contournement d'une vérification (si Strava en demande une, la synchronisation s'arrête avec un message).
//! Rien n'est écrit sur Strava (l'écriture des labels viendra, désactivée par défaut). Aucun mot de passe n'est stocké.
//!
//! Format repéré le 2026-11-14 sur une session réelle (et par l'ancien serveur Strava d'Eloi) : voir docs/notes/nolio-points-d-acces.md pour la méthode.

use crate::nolio::{date_depuis_jours, jour_de};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const ORIGINE: &str = "https://www.strava.com";
const PAR_PAGE: u32 = 20;
/// Pause entre deux pages de la liste : faible cadence côté Strava.
pub const PAUSE_ENTRE_PAGES: Duration = Duration::from_secs(3);

/// Clés de `tags` dans la liste, vérifiées sur la page d'édition d'une activité : seules ces trois sont gérées.
const LABELS: [(&str, &str); 3] = [("0", "LongRun"), ("1", "Race"), ("2", "Workout")];

#[derive(Debug, Clone, PartialEq)]
pub struct Activite {
    pub id: String,
    pub sport: String,
    pub nom: String,
    pub description: String,
    /// Labels gérés, triés, séparés par des virgules (« LongRun,Workout »). Vide : aucun.
    pub labels: String,
    pub debut: String,
    pub debut_local: String,
    pub duree_totale_s: i64,
    pub duree_mouvement_s: Option<i64>,
    pub distance_m: Option<f64>,
    pub denivele_m: Option<f64>,
}

fn nombre(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

/// 1793687340 (heure locale encodée comme si c'était de l'UTC) → « 2026-11-03T07:29:00 ».
fn iso_local(brut: i64) -> String {
    let jour = brut.div_euclid(86400);
    let s = brut.rem_euclid(86400);
    format!("{}T{:02}:{:02}:{:02}", date_depuis_jours(jour), s / 3600, (s % 3600) / 60, s % 60)
}

/// Une activité de la liste de Strava vers ce qu'on garde. Refuse ce qui n'a pas d'identifiant, de départ ou d'heure locale lisibles.
pub fn depuis_strava(m: &Value) -> Result<Activite, String> {
    let id = m["id_str"].as_str().filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())).ok_or_else(|| format!("activité Strava sans identifiant lisible : {}", m["id"]))?;
    let debut = m["start_time"].as_str().filter(|s| s.len() >= 19 && jour_de(&s[..10]).is_ok()).ok_or_else(|| format!("activité {id} : départ illisible"))?;
    let local = nombre(&m["start_date_local_raw"]).ok_or_else(|| format!("activité {id} : heure locale illisible"))?;
    let mut labels: Vec<&str> = LABELS.iter().filter(|(cle, _)| m["tags"][*cle].as_bool() == Some(true)).map(|(_, nom)| *nom).collect();
    labels.sort_unstable();
    Ok(Activite {
        id: id.to_string(),
        sport: m["sport_type"].as_str().or(m["type"].as_str()).unwrap_or("Unknown").to_string(),
        nom: m["name"].as_str().unwrap_or("").to_string(),
        description: m["description"].as_str().unwrap_or("").replace("\r\n", "\n"),
        labels: labels.join(","),
        debut: debut.to_string(),
        debut_local: iso_local(local.round() as i64),
        duree_totale_s: nombre(&m["elapsed_time_raw"]).map(|x| x.round() as i64).unwrap_or(0),
        duree_mouvement_s: nombre(&m["moving_time_raw"]).map(|x| x.round() as i64),
        distance_m: nombre(&m["distance_raw"]),
        denivele_m: nombre(&m["elevation_gain_raw"]),
    })
}

fn instantane(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT sport || '|' || nom || '|' || description || '|' || labels || '|' || debut || '|' || debut_local || '|' || duree_totale_s || '|' || coalesce(duree_mouvement_s,'') || '|' || coalesce(distance_m,'') || '|' || coalesce(denivele_m,'') FROM strava_activites WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .ok()
}

/// Écrit les activités (un identifiant Strava donne une ligne). Rend (nouvelles, modifiées) ; la date de lecture ne compte pas comme une modification.
/// Une activité supprimée sur Strava reste ici : la liste ne dit pas qu'elle a disparu.
pub fn enregistrer(conn: &Connection, activites: &[Activite], lu_le: &str) -> Result<(usize, usize), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (mut nouvelles, mut modifiees) = (0, 0);
    for a in activites {
        let avant = instantane(&tx, &a.id);
        tx.execute(
            "INSERT INTO strava_activites (id, sport, nom, description, labels, debut, debut_local, duree_totale_s, duree_mouvement_s, distance_m, denivele_m, lu_le)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(id) DO UPDATE SET sport=excluded.sport, nom=excluded.nom, description=excluded.description, labels=excluded.labels, debut=excluded.debut,
                debut_local=excluded.debut_local, duree_totale_s=excluded.duree_totale_s, duree_mouvement_s=excluded.duree_mouvement_s,
                distance_m=excluded.distance_m, denivele_m=excluded.denivele_m, lu_le=excluded.lu_le",
            params![a.id, a.sport, a.nom, a.description, a.labels, a.debut, a.debut_local, a.duree_totale_s, a.duree_mouvement_s, a.distance_m, a.denivele_m, lu_le],
        )
        .map_err(|e| format!("écriture de l'activité {} : {e}", a.id))?;
        match avant {
            None => nouvelles += 1,
            Some(a0) if instantane(&tx, &a.id).as_deref() != Some(a0.as_str()) => modifiees += 1,
            Some(_) => {}
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((nouvelles, modifiees))
}

// ---------- Script évalué dans la page de Strava ----------

/// Lit une page de la liste. Les nombres entrent dans le script après validation par leur type : rien d'autre n'y est inséré.
pub fn script_page(numero: u32, par_page: u32) -> String {
    format!(
        r#"(async () => {{
  try {{
    const r = await fetch("/athlete/training_activities?new_activity_only=false&page={numero}&per_page={par_page}", {{ headers: {{ Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }}, redirect: "manual" }});
    if (r.type === "opaqueredirect" || r.status === 401 || r.status === 403) return {{ connecte: false }};
    if (!r.ok) return {{ connecte: true, erreur: "HTTP " + r.status }};
    if (!(r.headers.get("content-type") || "").includes("json")) return {{ connecte: false }};
    const j = await r.json();
    return {{ connecte: true, models: Array.isArray(j.models) ? j.models : null, perPage: j.perPage, total: j.total }};
  }} catch (e) {{ return {{ connecte: true, erreur: String((e && e.message) || e) }}; }}
}})()"#
    )
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct Page {
    connecte: bool,
    models: Option<Vec<Value>>,
    #[serde(rename = "perPage")]
    per_page: Option<u64>,
    total: Option<u64>,
    erreur: Option<String>,
}

/// Vrai si une page de Strava est ouverte ET que la session répond. Se fait dans la page de l'utilisateur, sans ouvrir d'onglet.
pub fn verifier_connexion(s: &mut crate::navigateur::Session, origine: &str) -> bool {
    let Ok(Some(v)) = s.evaluer_sur_page(origine, &script_page(1, 1)) else { return false };
    serde_json::from_value::<Page>(v).map(|p| p.connecte && p.erreur.is_none() && p.models.is_some()).unwrap_or(false)
}

/// Ouvre une fenêtre sur Strava ; l'utilisateur se connecte lui-même (e-mail, code, Google…). Rend la main une fois la session valide.
pub fn connecter(exe: &Path, profil: &Path, origine: &str, annule: &AtomicBool, delai: Duration) -> Result<(), String> {
    crate::navigateur::connecter_fenetre(exe, profil, &format!("{origine}/login"), annule, delai, |s| verifier_connexion(s, origine))
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Bilan {
    pub pages: usize,
    pub nouvelles: usize,
    pub modifiees: usize,
    pub ignorees: Vec<String>,
}

/// Lit la liste page par page. `complet` : toutes les pages (modifications d'anciennes activités comprises) ; sinon, arrêt à la première page à partir de
/// la deuxième sans aucun changement (le passage courant, les activités récentes). `progression(page, pages_prevues)` informe l'interface.
pub fn synchroniser(
    exe: &Path,
    profil: &Path,
    origine: &str,
    complet: bool,
    pause: Duration,
    annule: &AtomicBool,
    mut enregistrer_fn: impl FnMut(&[Activite]) -> Result<(usize, usize), String>,
    mut progression: impl FnMut(usize, usize),
) -> Result<Bilan, String> {
    let mut s = crate::navigateur::lancer(exe, profil, false, "about:blank")?;
    let mut bilan = Bilan::default();
    let mut numero: u32 = 0;
    let mut suivant = |dernier: Option<Value>, bilan: &mut Bilan| -> Result<Option<String>, String> {
        if let Some(v) = dernier {
            let page: Page = serde_json::from_value(v).map_err(|e| format!("réponse de Strava illisible : {e}"))?;
            if !page.connecte {
                return Err("Strava n'est plus connecté (ou demande une vérification) : reconnecte-toi depuis Profil".into());
            }
            if let Some(e) = page.erreur {
                return Err(format!("liste des activités : {e}"));
            }
            let modeles = page.models.ok_or("liste des activités : réponse inattendue")?;
            let par_page = page.per_page.filter(|&p| p > 0).unwrap_or(PAR_PAGE as u64);
            let total = page.total.unwrap_or(0);
            let mut activites = Vec::new();
            for m in &modeles {
                match depuis_strava(m) {
                    Ok(a) => activites.push(a),
                    Err(e) => bilan.ignorees.push(e),
                }
            }
            let (n, m) = enregistrer_fn(&activites)?;
            bilan.pages += 1;
            bilan.nouvelles += n;
            bilan.modifiees += m;
            progression(numero as usize, total.div_ceil(par_page).max(1) as usize);
            let derniere = (modeles.len() as u64) < par_page || (numero as u64) * par_page >= total;
            if derniere || (!complet && numero >= 2 && n + m == 0) {
                return Ok(None);
            }
            if annule.load(Ordering::SeqCst) {
                return Err("synchronisation annulée".into());
            }
            std::thread::sleep(pause);
        } else if annule.load(Ordering::SeqCst) {
            return Err("synchronisation annulée".into());
        }
        numero += 1;
        Ok(Some(script_page(numero, PAR_PAGE)))
    };
    let r = s.evaluer_en_serie(&format!("{origine}/athlete/training"), &mut |v| suivant(v, &mut bilan));
    s.fermer();
    r?;
    Ok(bilan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    fn local_brut(date: &str, h: i64, m: i64) -> i64 {
        jour_de(date).unwrap() * 86400 + h * 3600 + m * 60
    }

    fn modele(id: u32, nom: &str, date: &str, h: i64) -> Value {
        json!({
            "id_str": id.to_string(), "name": nom, "sport_type": "Run", "description": "",
            "start_time": format!("{date}T{:02}:00:00Z", h - 1), "start_date_local_raw": local_brut(date, h, 0),
            "elapsed_time_raw": 3000, "moving_time_raw": 2950, "distance_raw": 10000.0, "elevation_gain_raw": 30.0,
            "tags": { "0": false, "1": false, "2": false, "4": false, "5": true }
        })
    }

    #[test]
    fn une_activite_de_la_liste_est_lue_avec_ses_labels_et_son_heure_locale() {
        let mut m = modele(1001, "Fractionné", "2026-11-03", 7);
        m["tags"] = json!({ "0": true, "1": false, "2": true, "5": true, "9": true });
        m["description"] = json!("6x400\r\nrécup 1'");
        let a = depuis_strava(&m).unwrap();
        assert_eq!((a.id.as_str(), a.sport.as_str(), a.nom.as_str()), ("1001", "Run", "Fractionné"));
        // Seuls LongRun, Race et Workout sont gérés, triés : les autres clés de `tags` (5, 9…) sont ignorées.
        assert_eq!(a.labels, "LongRun,Workout");
        assert_eq!(a.description, "6x400\nrécup 1'");
        assert_eq!(a.debut_local, "2026-11-03T07:00:00");
        assert_eq!(a.debut, "2026-11-03T06:00:00Z");
        assert_eq!((a.duree_totale_s, a.duree_mouvement_s, a.distance_m, a.denivele_m), (3000, Some(2950), Some(10000.0), Some(30.0)));
        // Aucun label géré.
        assert_eq!(depuis_strava(&modele(1, "Footing", "2026-11-03", 7)).unwrap().labels, "");
        // Race seule.
        let mut c = modele(2, "Semi", "2026-10-18", 9);
        c["tags"] = json!({ "1": true });
        assert_eq!(depuis_strava(&c).unwrap().labels, "Race");
    }

    #[test]
    fn l_heure_locale_se_decode_autour_de_minuit_et_des_changements_d_annee() {
        assert_eq!(iso_local(local_brut("2026-12-31", 23, 59)), "2026-12-31T23:59:00");
        assert_eq!(iso_local(local_brut("2027-01-01", 0, 0)), "2027-01-01T00:00:00");
        assert_eq!(iso_local(local_brut("2028-02-29", 0, 5)), "2028-02-29T00:05:00");
        assert_eq!(iso_local(0), "1970-01-01T00:00:00");
    }

    #[test]
    fn les_activites_illisibles_sont_refusees_et_les_champs_optionnels_tolerés() {
        for mauvaise in [
            json!({}),
            json!({ "id_str": "", "start_time": "2026-11-03T06:00:00Z", "start_date_local_raw": 1 }),
            json!({ "id_str": "12ab", "start_time": "2026-11-03T06:00:00Z", "start_date_local_raw": 1 }),
            json!({ "id_str": "12", "start_time": "hier", "start_date_local_raw": 1 }),
            json!({ "id_str": "12", "start_time": "2026-02-30T06:00:00Z", "start_date_local_raw": 1 }),
            json!({ "id_str": "12", "start_time": "2026-11-03T06:00:00Z" }),
            json!({ "id_str": "12", "start_time": "2026-11-03T06:00:00Z", "start_date_local_raw": "x" }),
        ] {
            assert!(depuis_strava(&mauvaise).is_err(), "{mauvaise} aurait dû être refusée");
        }
        let a = depuis_strava(&json!({ "id_str": "12", "start_time": "2026-11-03T06:00:00Z", "start_date_local_raw": local_brut("2026-11-03", 7, 0) })).unwrap();
        assert_eq!((a.sport.as_str(), a.nom.as_str(), a.labels.as_str(), a.duree_totale_s, a.duree_mouvement_s, a.distance_m), ("Unknown", "", "", 0, None, None));
        // Le type ancien (`type`) sert quand `sport_type` manque.
        let b = depuis_strava(&json!({ "id_str": "13", "type": "Ride", "start_time": "2026-11-03T06:00:00Z", "start_date_local_raw": local_brut("2026-11-03", 7, 0) })).unwrap();
        assert_eq!(b.sport, "Ride");
    }

    #[test]
    fn le_script_ne_contient_que_des_nombres() {
        let s = script_page(3, 20);
        assert!(s.contains("page=3&per_page=20"));
        assert!(s.contains("redirect: \"manual\""));
    }

    fn base_memoire() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::base::MIGRATIONS.iter().find(|m| m.contains("strava_activites")).expect("migration introuvable")).unwrap();
        c
    }

    #[test]
    fn relire_une_activite_ne_double_rien_et_compte_les_vraies_modifications() {
        let c = base_memoire();
        let a = depuis_strava(&modele(1, "Footing", "2026-11-03", 7)).unwrap();
        assert_eq!(enregistrer(&c, &[a.clone(), depuis_strava(&modele(2, "Sortie", "2026-11-04", 7)).unwrap()], "2026-11-14T10:00").unwrap(), (2, 0));
        assert_eq!(enregistrer(&c, &[a.clone()], "2026-11-14T11:00").unwrap(), (0, 0), "même contenu : ni nouvelle, ni modifiée");
        let mut b = a.clone();
        b.nom = "Footing facile".into();
        b.labels = "Workout".into();
        assert_eq!(enregistrer(&c, &[b], "2026-11-14T12:00").unwrap(), (0, 1));
        let n: i64 = c.query_row("SELECT count(*) FROM strava_activites", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        let nom: String = c.query_row("SELECT nom FROM strava_activites WHERE id = '1'", [], |r| r.get(0)).unwrap();
        assert_eq!(nom, "Footing facile");
    }

    // ---------- Bout en bout : vrai Chromium sans fenêtre contre un faux Strava local ----------

    /// Faux Strava : 5 activités, 2 par page (3 pages). `connecte` : false répond comme Strava sans session (redirection).
    /// `panne_page` : numéro de page qui répond 500. Compte les requêtes de liste dans `requetes`.
    fn faux_strava(connecte: bool, panne_page: Option<u32>, requetes: Arc<AtomicUsize>) -> String {
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let origine = format!("http://127.0.0.1:{}", ecoute.local_addr().unwrap().port());
        let tout: Vec<Value> = (1..=5u32).map(|i| modele(1000 + i, &format!("Sortie {i}"), "2026-11-03", 6 + i as i64)).collect();
        std::thread::spawn(move || {
            for flux in ecoute.incoming() {
                let Ok(mut flux) = flux else { continue };
                let mut tampon = [0u8; 4096];
                let n = flux.read(&mut tampon).unwrap_or(0);
                let requete = String::from_utf8_lossy(&tampon[..n]).to_string();
                let chemin = requete.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (route, requete_q) = chemin.split_once('?').unwrap_or((chemin.as_str(), ""));
                let (statut, type_, corps) = if route == "/athlete/training" {
                    ("200 OK", "text/html", "<html><body>entraînement</body></html>".to_string())
                } else if route == "/athlete/training_activities" {
                    requetes.fetch_add(1, Ordering::SeqCst);
                    let page: usize = requete_q.split('&').find_map(|p| p.strip_prefix("page=")).and_then(|v| v.parse().ok()).unwrap_or(1);
                    let par_page: usize = requete_q.split('&').find_map(|p| p.strip_prefix("per_page=")).and_then(|v| v.parse().ok()).unwrap_or(20);
                    if !connecte {
                        ("302 Found", "text/plain", String::new())
                    } else if panne_page == Some(page as u32) {
                        ("500 Internal Server Error", "text/plain", "panne".into())
                    } else {
                        // Le faux serveur sert 2 activités par page quel que soit per_page (Strava peut répondre moins que demandé).
                        let t = 2.min(par_page);
                        let models: Vec<Value> = tout.iter().skip((page - 1) * t).take(t).cloned().collect();
                        ("200 OK", "application/json", json!({ "models": models, "page": page, "perPage": t, "total": 5 }).to_string())
                    }
                } else {
                    ("404 Not Found", "text/plain", "inconnu".into())
                };
                let en_tete = format!("HTTP/1.1 {statut}\r\nContent-Type: {type_}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", corps.len(), if statut.starts_with("302") { "Location: /login\r\n" } else { "" });
                let _ = flux.write_all(en_tete.as_bytes());
                let _ = flux.write_all(corps.as_bytes());
            }
        });
        origine
    }

    fn dossier_test(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("foulee-strava-{}-{nom}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn chromium_ou_ignorer() -> Option<PathBuf> {
        match crate::navigateur::detecter().into_iter().next() {
            Some(n) => Some(PathBuf::from(n.chemin)),
            None => {
                assert!(std::env::var_os("FOULEE_EXIGER_NAVIGATEUR").is_none(), "aucun Chromium détecté alors qu'il est exigé");
                eprintln!("(pas de Chromium installé : test de bout en bout ignoré)");
                None
            }
        }
    }

    fn lancer_sync(exe: &Path, profil: &Path, origine: &str, complet: bool, base: &Connection, annule: &AtomicBool) -> Result<Bilan, String> {
        synchroniser(exe, profil, origine, complet, Duration::ZERO, annule, |a| enregistrer(base, a, "2026-11-14T10:00"), |_, _| {})
    }

    #[test]
    fn la_synchronisation_lit_toutes_les_pages_puis_s_arrete_vite_quand_rien_ne_change() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let requetes = Arc::new(AtomicUsize::new(0));
        let origine = faux_strava(true, None, requetes.clone());
        let dossier = dossier_test("sync");
        let base = base_memoire();
        let profil = dossier.join("profil");
        let mut etapes = Vec::new();
        let b = synchroniser(&exe, &profil, &origine, true, Duration::ZERO, &AtomicBool::new(false), |a| enregistrer(&base, a, "2026-11-14T10:00"), |p, t| etapes.push((p, t))).unwrap();
        assert_eq!((b.pages, b.nouvelles, b.modifiees), (3, 5, 0), "{b:?}");
        assert_eq!(etapes, vec![(1, 3), (2, 3), (3, 3)]);
        assert_eq!(requetes.load(Ordering::SeqCst), 3);
        let (nom, debut_local, labels): (String, String, String) = base.query_row("SELECT nom, debut_local, labels FROM strava_activites WHERE id = '1003'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((nom.as_str(), debut_local.as_str(), labels.as_str()), ("Sortie 3", "2026-11-03T09:00:00", ""));

        // Deuxième passage courant : rien n'a changé, on s'arrête à la page 2 sans lire la 3e.
        let avant = requetes.load(Ordering::SeqCst);
        let b2 = lancer_sync(&exe, &profil, &origine, false, &base, &AtomicBool::new(false)).unwrap();
        assert_eq!((b2.pages, b2.nouvelles, b2.modifiees), (2, 0, 0), "{b2:?}");
        assert_eq!(requetes.load(Ordering::SeqCst) - avant, 2, "le passage courant ne doit pas relire toute la liste");
        // Passage complet : tout est relu.
        let avant = requetes.load(Ordering::SeqCst);
        let b3 = lancer_sync(&exe, &profil, &origine, true, &base, &AtomicBool::new(false)).unwrap();
        assert_eq!(b3.pages, 3);
        assert_eq!(requetes.load(Ordering::SeqCst) - avant, 3);
        let n: i64 = base.query_row("SELECT count(*) FROM strava_activites", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn sans_session_la_synchronisation_s_arrete_sans_rien_ecrire() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let origine = faux_strava(false, None, Arc::new(AtomicUsize::new(0)));
        let dossier = dossier_test("deconnecte");
        let base = base_memoire();
        let m = lancer_sync(&exe, &dossier.join("profil"), &origine, true, &base, &AtomicBool::new(false)).unwrap_err();
        assert!(m.contains("reconnecte"), "message inattendu : {m}");
        let n: i64 = base.query_row("SELECT count(*) FROM strava_activites", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn une_panne_en_cours_de_route_garde_les_pages_deja_lues_et_le_dit() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let origine = faux_strava(true, Some(2), Arc::new(AtomicUsize::new(0)));
        let dossier = dossier_test("panne");
        let base = base_memoire();
        let m = lancer_sync(&exe, &dossier.join("profil"), &origine, true, &base, &AtomicBool::new(false)).unwrap_err();
        assert!(m.contains("HTTP 500"), "message inattendu : {m}");
        let n: i64 = base.query_row("SELECT count(*) FROM strava_activites", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "la première page était déjà enregistrée");
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn une_synchronisation_annulee_s_arrete_avant_de_lire() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let requetes = Arc::new(AtomicUsize::new(0));
        let origine = faux_strava(true, None, requetes.clone());
        let dossier = dossier_test("annule");
        let base = base_memoire();
        let m = lancer_sync(&exe, &dossier.join("profil"), &origine, true, &base, &AtomicBool::new(true)).unwrap_err();
        assert!(m.contains("annulée"));
        assert_eq!(requetes.load(Ordering::SeqCst), 0);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn la_verification_de_connexion_n_ouvre_aucun_onglet_et_distingue_connecte_et_deconnecte() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        for (connecte, nom) in [(true, "verif-oui"), (false, "verif-non")] {
            let origine = faux_strava(connecte, None, Arc::new(AtomicUsize::new(0)));
            let dossier = dossier_test(nom);
            let mut s = crate::navigateur::lancer(&exe, &dossier.join("profil"), false, &format!("{origine}/athlete/training")).unwrap();
            std::thread::sleep(Duration::from_millis(1500));
            let avant = s.urls_pages().unwrap().len();
            assert_eq!(verifier_connexion(&mut s, &origine), connecte);
            assert_eq!(s.urls_pages().unwrap().len(), avant, "la vérification ne doit ouvrir ni fermer d'onglet");
            s.fermer();
            let _ = std::fs::remove_dir_all(&dossier);
        }
    }
}

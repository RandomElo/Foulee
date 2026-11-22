//! Lecteur Garmin Connect par le navigateur piloté (lecture seule), sur le modèle de l'appli Android (Sync.kt) : profil (nom), activités, tours de la montre,
//! santé du jour (FC de repos, stress, batterie, sommeil, VFC, pas). L'utilisateur se connecte lui-même dans une vraie fenêtre (mot de passe, code de
//! vérification éventuel) : aucun identifiant n'est demandé ni stocké. Les mêmes services que l'appli Android sont appelés par la page connectée
//! (`/gc-api/<service>/…` avec l'en-tête `Connect-Csrf-Token` lu dans la page), à faible cadence.
//!
//! Adresses et jeton repérés le 2026-11-14 sur une session réelle : elles ne sont pas documentées par Garmin et peuvent changer, d'où des erreurs lisibles.

use crate::garmin_api::{Client, ErreurGarmin};
use crate::nolio::{decaler, jour_de};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const PAR_PAGE: u32 = 100;
/// Fenêtre de santé relue : les jours récents sont toujours relus (la journée n'est pas finie), les jours manquants des 90 derniers sont rattrapés.
const JOURS_RECENTS: i64 = 3;
const JOURS_FENETRE: i64 = 90;
const MAX_ACTIVITES: i64 = 2000;
const MAX_TOURS_PASSAGE_COURANT: i64 = 30;
const MAX_TOURS_COMPLET: i64 = 800;

// ---------- Ce que Garmin renvoie, mis en forme pour les lecteurs ci-dessous ----------

fn nombre(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Activite {
    pub garmin_id: i64,
    pub start_local: String,
    pub type_: String,
    pub nom: String,
    pub distance: Option<f64>,
    pub duree: Option<f64>,
    pub vitesse: Option<f64>,
    pub fc: Option<f64>,
    pub fc_max: Option<f64>,
    pub charge: Option<f64>,
    pub denivele: Option<f64>,
    /// Température minimale relevée par la montre (°C).
    pub temp_min: Option<f64>,
    /// Training Effect aérobie (0 à 5).
    pub te_aerobie: Option<f64>,
    /// Secondes passées dans chacune des 5 zones de FC, écrites « z1,z2,z3,z4,z5 ».
    pub zones_fc: Option<String>,
}

/// Une activité de la liste de Garmin. Refuse ce qui n'a pas d'identifiant ni de départ lisibles. L'heure est normalisée en « AAAA-MM-JJTHH:MM:SS ».
pub fn activite_depuis(v: &Value) -> Result<Activite, String> {
    let id = v["id"].as_i64().filter(|&i| i > 0).ok_or_else(|| format!("activité Garmin sans identifiant : {}", v["id"]))?;
    let debut = v["debut"].as_str().map(|s| s.trim().replace(' ', "T")).filter(|s| s.len() >= 19 && jour_de(&s[..10]).is_ok()).ok_or_else(|| format!("activité {id} : départ illisible"))?;
    Ok(Activite {
        garmin_id: id,
        start_local: debut[..19].to_string(),
        type_: v["type"].as_str().filter(|t| !t.is_empty()).unwrap_or("other").to_string(),
        nom: v["nom"].as_str().unwrap_or("Activité").to_string(),
        distance: nombre(&v["distance"]),
        duree: nombre(&v["duree"]),
        vitesse: nombre(&v["vitesse"]),
        fc: nombre(&v["fc"]),
        fc_max: nombre(&v["fcMax"]),
        charge: nombre(&v["charge"]),
        denivele: nombre(&v["denivele"]),
        temp_min: nombre(&v["tempMin"]),
        te_aerobie: nombre(&v["teAerobie"]).filter(|t| (0.0..=5.0).contains(t)),
        zones_fc: zones_depuis(&v["zones"]),
    })
}

/// Les 5 zones de FC en « z1,z2,z3,z4,z5 » : seulement si les cinq sont des nombres positifs ou nuls et que la montre en a mesuré (une somme nulle veut dire « pas de FC »).
fn zones_depuis(v: &Value) -> Option<String> {
    let z: Vec<f64> = v.as_array()?.iter().map(nombre).collect::<Option<Vec<f64>>>()?;
    (z.len() == 5 && z.iter().all(|x| *x >= 0.0) && z.iter().sum::<f64>() > 0.0).then(|| z.iter().map(|x| x.round().to_string()).collect::<Vec<_>>().join(","))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tour {
    pub idx: i64,
    pub distance: Option<f64>,
    pub duree: Option<f64>,
    pub vitesse: Option<f64>,
    pub fc: Option<f64>,
    pub fc_max: Option<f64>,
    pub denivele: Option<f64>,
    pub intensite: Option<String>,
    pub etape: Option<i64>,
}

fn tours_depuis(v: &Value) -> Vec<Tour> {
    v.as_array()
        .map(|a| {
            a.iter()
                .enumerate()
                .map(|(i, l)| Tour {
                    idx: i as i64,
                    distance: nombre(&l["distance"]),
                    duree: nombre(&l["duree"]),
                    vitesse: nombre(&l["vitesse"]),
                    fc: nombre(&l["fc"]),
                    fc_max: nombre(&l["fcMax"]),
                    denivele: nombre(&l["denivele"]),
                    intensite: l["intensite"].as_str().filter(|s| !s.is_empty() && *s != "null").map(str::to_string),
                    etape: l["etape"].as_i64(),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Jour {
    pub date: String,
    pub fc_repos: Option<f64>,
    pub stress: Option<f64>,
    pub batterie: Option<f64>,
    pub sommeil_s: Option<f64>,
    pub score_sommeil: Option<f64>,
    pub vfc: Option<f64>,
    pub pas: Option<f64>,
}

/// Un jour de santé. Garmin met des valeurs négatives pour « pas assez de données » : elles deviennent « rien ». Un jour sans aucune valeur n'est pas gardé
/// (il ne serait jamais relu).
pub fn jour_depuis(v: &Value) -> Result<Option<Jour>, String> {
    let date = v["date"].as_str().filter(|d| jour_de(d).is_ok()).ok_or_else(|| format!("jour illisible : {}", v["date"]))?.to_string();
    let positif = |k: &str| nombre(&v[k]).filter(|x| *x >= 0.0);
    let j = Jour { date, fc_repos: positif("fcRepos"), stress: positif("stress"), batterie: positif("batterie"), sommeil_s: positif("sommeilS"), score_sommeil: positif("scoreSommeil"), vfc: positif("vfc"), pas: positif("pas") };
    let vide = [j.fc_repos, j.stress, j.batterie, j.sommeil_s, j.score_sommeil, j.vfc, j.pas].iter().all(Option::is_none);
    Ok(if vide { None } else { Some(j) })
}

// ---------- Base ----------

/// Écrit les activités (clé : source « garmin » + identifiant Garmin). La catégorie choisie à la main et le TRIMP ne sont jamais écrasés.
/// Rend (nouvelles, modifiées).
pub fn enregistrer_activites(conn: &Connection, acts: &[Activite]) -> Result<(usize, usize), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (mut nouvelles, mut modifiees) = (0, 0);
    let instantane = |tx: &Connection, id: &str| -> Option<String> {
        tx.query_row(
            "SELECT start_local || '|' || type || '|' || name || '|' || coalesce(distance,'') || '|' || coalesce(duration,'') || '|' || coalesce(avg_speed,'') || '|' || coalesce(avg_hr,'') || '|' || coalesce(max_hr,'') || '|' || coalesce(training_load,'') || '|' || coalesce(elevation,'') FROM activities WHERE source = 'garmin' AND external_id = ?1",
            [id],
            |r| r.get(0),
        )
        .ok()
    };
    for a in acts {
        let ext = a.garmin_id.to_string();
        let avant = instantane(&tx, &ext);
        tx.execute(
            "INSERT INTO activities (source, external_id, start_local, type, distance, duration, avg_speed, avg_hr, max_hr, training_load, name, elevation, min_temperature, aerobic_te, hr_zones)
             VALUES ('garmin', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT (source, external_id) DO UPDATE SET start_local=excluded.start_local, type=excluded.type, distance=excluded.distance, duration=excluded.duration,
                avg_speed=excluded.avg_speed, avg_hr=excluded.avg_hr, max_hr=excluded.max_hr, training_load=excluded.training_load, name=excluded.name, elevation=excluded.elevation,
                min_temperature=excluded.min_temperature, aerobic_te=excluded.aerobic_te, hr_zones=excluded.hr_zones",
            params![ext, a.start_local, a.type_, a.distance, a.duree, a.vitesse, a.fc, a.fc_max, a.charge, a.nom, a.denivele, a.temp_min, a.te_aerobie, a.zones_fc],
        )
        .map_err(|e| format!("écriture de l'activité {ext} : {e}"))?;
        match avant {
            None => nouvelles += 1,
            Some(a0) if instantane(&tx, &ext).as_deref() != Some(a0.as_str()) => modifiees += 1,
            Some(_) => {}
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((nouvelles, modifiees))
}

/// Remplace les tours d'une activité Garmin (une activité sans tours en garde zéro : elle ne sera plus redemandée tant qu'elle n'est pas marquée).
pub fn enregistrer_tours(conn: &Connection, garmin_id: i64, tours: &[Tour]) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let id: i64 = tx.query_row("SELECT id FROM activities WHERE source = 'garmin' AND external_id = ?1", [garmin_id.to_string()], |r| r.get(0)).map_err(|_| format!("activité {garmin_id} inconnue"))?;
    tx.execute("DELETE FROM laps WHERE activity_id = ?1", [id]).map_err(|e| e.to_string())?;
    for t in tours {
        tx.execute(
            "INSERT INTO laps (activity_id, idx, distance, duration, avg_speed, avg_hr, max_hr, elevation_gain, intensity_type, step_index) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id, t.idx, t.distance, t.duree, t.vitesse, t.fc, t.fc_max, t.denivele, t.intensite, t.etape],
        )
        .map_err(|e| format!("écriture d'un tour : {e}"))?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn enregistrer_jours(conn: &Connection, jours: &[Jour]) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for j in jours {
        tx.execute(
            "INSERT INTO daily (date, resting_hr, avg_stress, body_battery_high, sleep_seconds, sleep_score, hrv_night, steps) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT (date) DO UPDATE SET resting_hr=excluded.resting_hr, avg_stress=excluded.avg_stress, body_battery_high=excluded.body_battery_high,
                sleep_seconds=excluded.sleep_seconds, sleep_score=excluded.sleep_score, hrv_night=excluded.hrv_night, steps=excluded.steps",
            params![j.date, j.fc_repos, j.stress, j.batterie, j.sommeil_s, j.score_sommeil, j.vfc, j.pas],
        )
        .map_err(|e| format!("écriture du jour {} : {e}", j.date))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(jours.len())
}

/// Les courses d'au moins 1 km les plus récentes qui n'ont pas encore de tours (identifiants Garmin) : de quoi détecter les fractionnés.
pub fn sans_tours(conn: &Connection, limite: i64) -> Result<Vec<i64>, String> {
    let mut st = conn
        .prepare("SELECT external_id FROM activities a WHERE source = 'garmin' AND type LIKE '%running%' AND coalesce(distance,0) >= 1000 AND NOT EXISTS (SELECT 1 FROM laps WHERE activity_id = a.id) ORDER BY start_local DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let ids = st.query_map([limite], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).filter_map(|s| s.parse::<i64>().ok()).collect();
    Ok(ids)
}

/// Les jours à lire : les derniers jours (toujours), puis les jours manquants de la fenêtre (ou ceux dont la nuit manque), du plus récent au plus ancien.
pub fn jours_a_lire(conn: &Connection, aujourdhui: &str, max_rattrapage: usize) -> Result<Vec<String>, String> {
    let debut = decaler(aujourdhui, -(JOURS_FENETRE - 1))?;
    let mut st = conn.prepare("SELECT date FROM daily WHERE date >= ?1 AND sleep_seconds IS NOT NULL").map_err(|e| e.to_string())?;
    let complets: std::collections::HashSet<String> = st.query_map([&debut], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    let mut jours: Vec<String> = (0..JOURS_RECENTS).map(|i| decaler(aujourdhui, -i)).collect::<Result<_, _>>()?;
    let mut rattrapage = 0;
    for i in JOURS_RECENTS..JOURS_FENETRE {
        let d = decaler(aujourdhui, -i)?;
        if !complets.contains(&d) {
            jours.push(d);
            rattrapage += 1;
            if rattrapage >= max_rattrapage {
                break;
            }
        }
    }
    Ok(jours)
}

/// Garde le prénom (premier mot du nom complet) dans les réglages, sans écraser un prénom que l'utilisateur aurait mis lui-même.
pub fn enregistrer_prenom(conn: &Connection, nom_complet: &str) -> Result<(), String> {
    let prenom = nom_complet.split_whitespace().next().unwrap_or("");
    if prenom.is_empty() || prenom.chars().count() > 60 {
        return Ok(());
    }
    let deja: Option<String> = conn.query_row("SELECT valeur FROM reglages WHERE cle = 'prenom'", [], |r| r.get(0)).ok();
    if deja.as_deref().is_some_and(|p| !p.trim().is_empty()) {
        return Ok(());
    }
    conn.execute("INSERT INTO reglages (cle, valeur) VALUES ('prenom', ?1) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur", [prenom]).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Lecture de l'API ----------

/// Une activité de la liste de Garmin vers la forme lue par `activite_depuis`.
fn activite_brute(a: &Value) -> Value {
    json!({ "id": a["activityId"], "debut": a["startTimeLocal"], "type": a["activityType"]["typeKey"], "nom": a["activityName"], "distance": a["distance"], "duree": a["duration"],
        "vitesse": a["averageSpeed"], "fc": a["averageHR"], "fcMax": a["maxHR"], "charge": a["activityTrainingLoad"], "denivele": a["elevationGain"],
        "tempMin": a["minTemperature"], "teAerobie": a["aerobicTrainingEffect"],
        "zones": json!([a["hrTimeInZone_1"], a["hrTimeInZone_2"], a["hrTimeInZone_3"], a["hrTimeInZone_4"], a["hrTimeInZone_5"]]) })
}

/// Les tours (« lapDTOs ») d'une activité vers la forme lue par `tours_depuis`.
fn tours_bruts(j: &Value) -> Value {
    Value::Array(
        j["lapDTOs"].as_array().map(|l| l.iter().map(|t| json!({ "distance": t["distance"], "duree": t["duration"], "vitesse": t["averageSpeed"], "fc": t["averageHR"], "fcMax": t["maxHR"], "denivele": t["elevationGain"], "intensite": t["intensityType"], "etape": t["wktStepIndex"] })).collect()).unwrap_or_default(),
    )
}

/// Le résumé du jour, la nuit et la VFC vers la forme lue par `jour_depuis` (comme Sync.kt : la VFC de la nuit sert de repli quand l'appel VFC est vide).
fn jour_brut(date: &str, resume: &Value, sommeil: &Value, vfc: &Value) -> Value {
    let dto = &sommeil["dailySleepDTO"];
    json!({
        "date": date, "fcRepos": resume["restingHeartRate"], "stress": resume["averageStressLevel"], "batterie": resume["bodyBatteryHighestValue"], "pas": resume["totalSteps"],
        "sommeilS": dto["sleepTimeSeconds"], "scoreSommeil": dto["sleepScores"]["overall"]["value"],
        "vfc": if vfc["hrvSummary"]["lastNightAvg"].is_number() { vfc["hrvSummary"]["lastNightAvg"].clone() } else { sommeil["avgOvernightHrv"].clone() },
    })
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Bilan {
    pub nouvelles: usize,
    pub modifiees: usize,
    pub tours: usize,
    pub jours: usize,
    pub ignorees: Vec<String>,
}

/// Un appel facultatif : une erreur autre que « session perdue » donne « rien » (comme `optional` de Sync.kt), la session perdue arrête tout.
fn facultatif(client: &mut Client, chemin: &str) -> Result<Value, String> {
    match client.get(chemin) {
        Ok(v) => Ok(v),
        Err(ErreurGarmin::Auth(m)) => Err(m),
        Err(_) => Ok(Value::Null),
    }
}

/// Lit Garmin : profil (prénom), activités (les 20 dernières, ou tout l'historique avec `complet`), tours des courses qui n'en ont pas, santé des jours récents et manquants.
/// `progression(étape, fait, total)` informe l'interface. Chaque lot est écrit dès qu'il est lu : une panne garde ce qui est déjà là.
pub fn synchroniser(
    client: &mut Client,
    complet: bool,
    pause: Duration,
    annule: &AtomicBool,
    mut avec_base: impl FnMut(&mut dyn FnMut(&Connection) -> Result<(), String>) -> Result<(), String>,
    mut progression: impl FnMut(&str, usize, usize),
) -> Result<Bilan, String> {
    let verifier = || if annule.load(Ordering::SeqCst) { Err("synchronisation annulée".to_string()) } else { Ok(()) };
    let mut bilan = Bilan::default();
    verifier()?;
    progression("Profil", 0, 1);
    let profil = client.get("/userprofile-service/socialProfile")?;
    let nom_affichage = profil["displayName"].as_str().filter(|n| !n.is_empty()).ok_or("Garmin n'a pas donné le nom du profil")?.to_string();
    if let Some(nom_complet) = profil["fullName"].as_str() {
        avec_base(&mut |c| enregistrer_prenom(c, nom_complet))?;
    }

    // Activités
    let voulu = if complet { facultatif(client, "/activitylist-service/activities/count")?["totalCount"].as_i64().unwrap_or(0).clamp(1, MAX_ACTIVITES) } else { 20 };
    let limite = if complet { PAR_PAGE } else { 20 };
    let mut debut: u32 = 0;
    loop {
        verifier()?;
        let page = client.get(&format!("/activitylist-service/activities/search/activities?start={debut}&limit={limite}"))?;
        let items = page.as_array().cloned().unwrap_or_default();
        let mut acts = Vec::new();
        for it in &items {
            match activite_depuis(&activite_brute(it)) {
                Ok(a) => acts.push(a),
                Err(e) => bilan.ignorees.push(e),
            }
        }
        let (mut n, mut m) = (0, 0);
        avec_base(&mut |c| {
            let (a, b) = enregistrer_activites(c, &acts)?;
            n = a;
            m = b;
            Ok(())
        })?;
        bilan.nouvelles += n;
        bilan.modifiees += m;
        let recues = debut as usize + items.len();
        progression("Activités", recues.min(voulu as usize), voulu as usize);
        if !complet || (items.len() as u32) < limite || recues as i64 >= voulu {
            break;
        }
        debut += limite;
        std::thread::sleep(pause);
    }

    // Tours des courses qui n'en ont pas
    let mut ids = Vec::new();
    avec_base(&mut |c| {
        ids = sans_tours(c, if complet { MAX_TOURS_COMPLET } else { MAX_TOURS_PASSAGE_COURANT })?;
        Ok(())
    })?;
    for (i, id) in ids.iter().enumerate() {
        verifier()?;
        let j = facultatif(client, &format!("/activity-service/activity/{id}/splits"))?;
        if !j.is_null() {
            let tours = tours_depuis(&tours_bruts(&j));
            avec_base(&mut |c| enregistrer_tours(c, *id, &tours))?;
            bilan.tours += 1;
        }
        progression("Tours", i + 1, ids.len());
        std::thread::sleep(pause);
    }

    // Santé des jours
    let aujourdhui = crate::nolio::aujourd_hui();
    let mut jours = Vec::new();
    avec_base(&mut |c| {
        jours = jours_a_lire(c, &aujourdhui, if complet { JOURS_FENETRE as usize } else { 30 })?;
        Ok(())
    })?;
    for (i, jour) in jours.iter().enumerate() {
        verifier()?;
        let resume = facultatif(client, &format!("/usersummary-service/usersummary/daily/{nom_affichage}?calendarDate={jour}"))?;
        let sommeil = facultatif(client, &format!("/sleep-service/sleep/dailySleepData?date={jour}"))?;
        let vfc = facultatif(client, &format!("/hrv-service/hrv/{jour}"))?;
        // Rien du tout (panne réseau) : pas de ligne vide, elle ne serait jamais relue.
        if !(resume.is_null() && sommeil.is_null() && vfc.is_null()) {
            match jour_depuis(&jour_brut(jour, &resume, &sommeil, &vfc)) {
                Ok(Some(x)) => {
                    avec_base(&mut |c| enregistrer_jours(c, std::slice::from_ref(&x)).map(|_| ()))?;
                    bilan.jours += 1;
                }
                Ok(None) => {}
                Err(e) => bilan.ignorees.push(e),
            }
        }
        progression("Santé", i + 1, jours.len());
        std::thread::sleep(pause);
    }
    Ok(bilan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        for m in crate::base::MIGRATIONS {
            c.execute_batch(m).unwrap();
        }
        c
    }

    fn act(id: i64, debut: &str, type_: &str, distance: f64) -> Value {
        json!({ "id": id, "debut": debut, "type": type_, "nom": format!("Sortie {id}"), "distance": distance, "duree": 3000.0, "vitesse": 3.3, "fc": 150.0, "fcMax": 170.0, "charge": 80.0, "denivele": 20.0 })
    }

    #[test]
    fn une_activite_garmin_est_lue_avec_une_heure_normalisee() {
        let a = activite_depuis(&act(25057158309, "2026-11-12 16:52:03", "running", 16191.0)).unwrap();
        assert_eq!((a.garmin_id, a.start_local.as_str(), a.type_.as_str()), (25057158309, "2026-11-12T16:52:03", "running"));
        assert_eq!((a.distance, a.fc, a.charge), (Some(16191.0), Some(150.0), Some(80.0)));
        // Champs absents : tolérés. Type absent : « other » comme sur Android.
        let b = activite_depuis(&json!({ "id": 5, "debut": "2026-11-12 07:00:00" })).unwrap();
        assert_eq!((b.type_.as_str(), b.nom.as_str(), b.distance), ("other", "Activité", None));
        for mauvaise in [json!({}), json!({ "id": 0, "debut": "2026-11-12 07:00:00" }), json!({ "id": 5, "debut": "hier" }), json!({ "id": 5, "debut": "2026-02-30 07:00:00" }), json!({ "id": "x", "debut": "2026-11-12 07:00:00" })] {
            assert!(activite_depuis(&mauvaise).is_err(), "{mauvaise} aurait dû être refusée");
        }
    }

    #[test]
    fn la_temperature_le_training_effect_et_les_zones_de_fc_sont_lus_et_gardes() {
        let liste = json!({ "activityId": 9, "activityName": "Tempo", "startTimeLocal": "2026-11-12 07:00:00", "activityType": { "typeKey": "running" }, "distance": 10000.0, "averageHR": 160.0,
            "minTemperature": 8.5, "aerobicTrainingEffect": 3.9, "hrTimeInZone_1": 60.0, "hrTimeInZone_2": 1200.4, "hrTimeInZone_3": 900.0, "hrTimeInZone_4": 300.0, "hrTimeInZone_5": 0.0 });
        let a = activite_depuis(&activite_brute(&liste)).unwrap();
        assert_eq!((a.temp_min, a.te_aerobie, a.zones_fc.as_deref()), (Some(8.5), Some(3.9), Some("60,1200,900,300,0")));
        // Sans mesure de FC (somme nulle), zones incomplètes ou Training Effect hors échelle : rien, pas des zéros.
        let vide = activite_depuis(&activite_brute(&json!({ "activityId": 10, "startTimeLocal": "2026-11-12 07:00:00", "hrTimeInZone_1": 0.0, "hrTimeInZone_2": 0.0, "hrTimeInZone_3": 0.0, "hrTimeInZone_4": 0.0, "hrTimeInZone_5": 0.0, "aerobicTrainingEffect": 9.0 }))).unwrap();
        assert_eq!((vide.temp_min, vide.te_aerobie, vide.zones_fc), (None, None, None));
        let partiel = activite_depuis(&activite_brute(&json!({ "activityId": 11, "startTimeLocal": "2026-11-12 07:00:00", "hrTimeInZone_1": 60.0 }))).unwrap();
        assert_eq!(partiel.zones_fc, None);
        // Écrites en base, relues, et remplacées à la relecture sans toucher à la catégorie choisie à la main.
        let c = base();
        enregistrer_activites(&c, &[a.clone()]).unwrap();
        c.execute("UPDATE activities SET manual_category = 'easy'", []).unwrap();
        let ligne = |c: &Connection| c.query_row("SELECT min_temperature, aerobic_te, hr_zones, manual_category FROM activities", [], |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<f64>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?))).unwrap();
        assert_eq!(ligne(&c), (Some(8.5), Some(3.9), Some("60,1200,900,300,0".to_string()), Some("easy".to_string())));
        let mut b = a;
        b.temp_min = Some(11.0);
        enregistrer_activites(&c, &[b]).unwrap();
        assert_eq!(ligne(&c).0, Some(11.0));
        assert_eq!(ligne(&c).3.as_deref(), Some("easy"));
    }

    #[test]
    fn les_tours_gardent_l_ordre_et_les_etapes_nulles() {
        let t = tours_depuis(&json!([{ "distance": 1000.0, "duree": 300.0, "intensite": "ACTIVE", "etape": 2 }, { "distance": 200.0, "intensite": "null", "etape": null }]));
        assert_eq!(t.len(), 2);
        assert_eq!((t[0].idx, t[0].intensite.as_deref(), t[0].etape), (0, Some("ACTIVE"), Some(2)));
        assert_eq!((t[1].idx, t[1].intensite.clone(), t[1].etape), (1, None, None));
        assert!(tours_depuis(&json!(null)).is_empty());
    }

    #[test]
    fn la_sante_ignore_les_valeurs_negatives_et_les_jours_vides() {
        let j = jour_depuis(&json!({ "date": "2026-11-12", "fcRepos": 42.0, "stress": -1.0, "batterie": 88.0, "sommeilS": 27000.0, "scoreSommeil": 81.0, "vfc": 62.0, "pas": 12345.0 })).unwrap().unwrap();
        assert_eq!((j.fc_repos, j.stress, j.batterie, j.sommeil_s, j.pas), (Some(42.0), None, Some(88.0), Some(27000.0), Some(12345.0)));
        assert_eq!(jour_depuis(&json!({ "date": "2026-11-12", "stress": -2.0 })).unwrap(), None, "un jour sans aucune valeur n'est pas gardé");
        assert!(jour_depuis(&json!({ "date": "demain" })).is_err());
    }

    #[test]
    fn relire_une_activite_ne_double_rien_et_garde_la_categorie_choisie_a_la_main() {
        let c = base();
        let a = activite_depuis(&act(1, "2026-11-12 16:52:03", "running", 10000.0)).unwrap();
        assert_eq!(enregistrer_activites(&c, &[a.clone(), activite_depuis(&act(2, "2026-11-11 07:00:00", "cycling", 30000.0)).unwrap()]).unwrap(), (2, 0));
        c.execute("UPDATE activities SET manual_category = 'long', trimp = 55 WHERE external_id = '1'", []).unwrap();
        assert_eq!(enregistrer_activites(&c, &[a.clone()]).unwrap(), (0, 0), "même contenu");
        let mut b = a.clone();
        b.nom = "Sortie renommée".into();
        b.distance = Some(10500.0);
        assert_eq!(enregistrer_activites(&c, &[b]).unwrap(), (0, 1));
        let (cat, trimp, nom): (Option<String>, Option<f64>, String) = c.query_row("SELECT manual_category, trimp, name FROM activities WHERE external_id = '1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((cat.as_deref(), trimp, nom.as_str()), (Some("long"), Some(55.0), "Sortie renommée"));
        let n: i64 = c.query_row("SELECT count(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn les_tours_se_remplacent_et_les_courses_sans_tours_sont_demandees_en_premier_les_plus_recentes() {
        let c = base();
        let acts: Vec<Activite> = [(1, "2026-11-01 07:00:00", "running", 10000.0), (2, "2026-11-12 07:00:00", "running", 8000.0), (3, "2026-11-10 07:00:00", "cycling", 30000.0), (4, "2026-11-11 07:00:00", "running", 500.0), (5, "2026-11-05 07:00:00", "treadmill_running", 5000.0)]
            .iter()
            .map(|(i, d, t, k)| activite_depuis(&act(*i, d, t, *k)).unwrap())
            .collect();
        enregistrer_activites(&c, &acts).unwrap();
        // Ni le vélo, ni la course de 500 m : seulement les courses d'au moins 1 km, la plus récente d'abord.
        assert_eq!(sans_tours(&c, 10).unwrap(), vec![2, 5, 1]);
        assert_eq!(sans_tours(&c, 2).unwrap(), vec![2, 5]);
        let t = |n: usize| (0..n).map(|i| Tour { idx: i as i64, distance: Some(1000.0), duree: Some(300.0), vitesse: None, fc: None, fc_max: None, denivele: None, intensite: None, etape: None }).collect::<Vec<_>>();
        enregistrer_tours(&c, 2, &t(3)).unwrap();
        enregistrer_tours(&c, 2, &t(2)).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM laps", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "relire remplace, n'ajoute pas");
        assert_eq!(sans_tours(&c, 10).unwrap(), vec![5, 1]);
        assert!(enregistrer_tours(&c, 999, &t(1)).is_err(), "activité inconnue");
    }

    #[test]
    fn les_jours_a_lire_sont_les_recents_puis_les_manquants_sans_depasser_la_limite() {
        let c = base();
        let auj = "2026-11-14";
        let tous = jours_a_lire(&c, auj, 5).unwrap();
        assert_eq!(&tous[..3], ["2026-11-14", "2026-11-13", "2026-11-12"]);
        assert_eq!(tous.len(), 3 + 5, "3 récents + 5 de rattrapage");
        assert_eq!(tous[3], "2026-11-11");
        // Un jour déjà complet (avec sa nuit) n'est pas redemandé ; un jour sans nuit l'est.
        c.execute("INSERT INTO daily (date, sleep_seconds) VALUES ('2026-11-11', 27000)", []).unwrap();
        c.execute("INSERT INTO daily (date, steps) VALUES ('2026-11-10', 9000)", []).unwrap();
        let apres = jours_a_lire(&c, auj, 3).unwrap();
        assert_eq!(&apres[3..], ["2026-11-10", "2026-11-09", "2026-11-08"], "le 11 est complet, le 10 n'a pas sa nuit");
        assert_eq!(enregistrer_jours(&c, &[Jour { date: "2026-11-10".into(), fc_repos: Some(40.0), stress: None, batterie: None, sommeil_s: Some(25000.0), score_sommeil: None, vfc: None, pas: Some(9000.0) }]).unwrap(), 1);
        assert!(!jours_a_lire(&c, auj, 3).unwrap().contains(&"2026-11-10".to_string()), "le 10 a maintenant sa nuit");
    }

    #[test]
    fn le_prenom_vient_du_nom_complet_sans_ecraser_celui_de_l_utilisateur() {
        let c = base();
        enregistrer_prenom(&c, "Camille Dupont").unwrap();
        let p: String = c.query_row("SELECT valeur FROM reglages WHERE cle = 'prenom'", [], |r| r.get(0)).unwrap();
        assert_eq!(p, "Camille");
        enregistrer_prenom(&c, "Autre Nom").unwrap();
        let p: String = c.query_row("SELECT valeur FROM reglages WHERE cle = 'prenom'", [], |r| r.get(0)).unwrap();
        assert_eq!(p, "Camille", "un prénom déjà présent n'est pas écrasé");
        let c2 = base();
        enregistrer_prenom(&c2, "   ").unwrap();
        enregistrer_prenom(&c2, &"x".repeat(200)).unwrap();
        let n: i64 = c2.query_row("SELECT count(*) FROM reglages WHERE cle = 'prenom'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    // ---------- Synchronisation complète contre le faux Garmin (sans navigateur) ----------

    use crate::garmin_api::faux::{lancer, Mode};

    fn client_connecte(mode: Mode) -> Client {
        let (hotes, _) = lancer(mode);
        let mut c = Client::nouveau(hotes, None).unwrap();
        c.attente = Duration::from_millis(1);
        c.connecter("eloi@example.com", "secret").unwrap();
        c
    }

    fn lancer_sync(client: &mut Client, complet: bool, c: &Connection, annule: &AtomicBool, etapes: &mut Vec<String>) -> Result<Bilan, String> {
        synchroniser(client, complet, Duration::ZERO, annule, |f| f(c), |e, fait, total| etapes.push(format!("{e} {fait}/{total}")))
    }

    #[test]
    fn la_synchronisation_lit_profil_activites_tours_et_sante() {
        let mut client = client_connecte(Mode::Normal);
        let c = base();
        let mut etapes = Vec::new();
        let b = lancer_sync(&mut client, true, &c, &AtomicBool::new(false), &mut etapes).unwrap();
        assert_eq!((b.nouvelles, b.modifiees), (5, 0), "{b:?}");
        // Trois courses d'au moins 1 km (101, 102, 104) ; la 105 fait 500 m ; le vélo n'a pas de tours.
        assert_eq!(b.tours, 3, "{b:?}");
        assert!(b.jours >= 3, "la santé des jours récents est lue : {b:?}");
        assert!(b.ignorees.is_empty(), "{:?}", b.ignorees);
        let prenom: String = c.query_row("SELECT valeur FROM reglages WHERE cle = 'prenom'", [], |r| r.get(0)).unwrap();
        assert_eq!(prenom, "Camille");
        let (debut, type_): (String, String) = c.query_row("SELECT start_local, type FROM activities WHERE external_id = '101'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((debut.as_str(), type_.as_str()), ("2026-11-12T16:52:03", "running"));
        let tours: i64 = c.query_row("SELECT count(*) FROM laps l JOIN activities a ON a.id = l.activity_id WHERE a.external_id = '101'", [], |r| r.get(0)).unwrap();
        assert_eq!(tours, 2);
        let (repos, stress, sommeil, vfc): (f64, Option<f64>, f64, Option<f64>) = c.query_row("SELECT resting_hr, avg_stress, sleep_seconds, hrv_night FROM daily ORDER BY date DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!((repos, stress, sommeil, vfc), (41.0, None, 27000.0, Some(61.0)), "stress négatif = rien ; VFC de repli sur la nuit quand l'appel VFC est vide");
        assert!(etapes.iter().any(|e| e == "Activités 5/5") && etapes.iter().any(|e| e.starts_with("Tours")) && etapes.iter().any(|e| e.starts_with("Santé")), "{etapes:?}");

        // Passage courant : rien de nouveau, la course en panne (105 : 500 m, hors tours) ne casse rien.
        let b2 = lancer_sync(&mut client, false, &c, &AtomicBool::new(false), &mut Vec::new()).unwrap();
        assert_eq!((b2.nouvelles, b2.modifiees), (0, 0), "{b2:?}");
        let n: i64 = c.query_row("SELECT count(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5);
    }

    #[test]
    fn une_session_perdue_en_cours_de_route_garde_ce_qui_est_lu_et_demande_de_se_reconnecter() {
        let (hotes, _) = lancer(Mode::Revoque);
        let mut client = Client::nouveau(hotes, Some(crate::garmin_api::Jetons { oauth1_token: "tok+1".into(), oauth1_secret: "sec".into() })).unwrap();
        let c = base();
        let m = lancer_sync(&mut client, true, &c, &AtomicBool::new(false), &mut Vec::new()).unwrap_err();
        assert!(m.contains("renouvellement"), "message inattendu : {m}");
        let n: i64 = c.query_row("SELECT count(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn une_synchronisation_annulee_s_arrete_avant_de_lire() {
        let mut client = client_connecte(Mode::Normal);
        let c = base();
        let m = lancer_sync(&mut client, true, &c, &AtomicBool::new(true), &mut Vec::new()).unwrap_err();
        assert!(m.contains("annulée"));
        let n: i64 = c.query_row("SELECT count(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn les_mises_en_forme_de_l_api_suivent_les_champs_de_garmin() {
        let a = activite_depuis(&activite_brute(&json!({ "activityId": 7, "activityName": "Footing", "startTimeLocal": "2026-11-12 07:00:00", "activityType": { "typeKey": "running" }, "distance": 8000.0, "averageHR": 148.0 }))).unwrap();
        assert_eq!((a.garmin_id, a.nom.as_str(), a.type_.as_str(), a.distance, a.fc), (7, "Footing", "running", Some(8000.0), Some(148.0)));
        assert_eq!(tours_depuis(&tours_bruts(&json!({ "lapDTOs": [{ "distance": 1000.0, "wktStepIndex": null }, { "distance": 200.0, "wktStepIndex": 3, "intensityType": "REST" }] }))).len(), 2);
        assert!(tours_depuis(&tours_bruts(&json!({}))).is_empty());
        // VFC : l'appel dédié gagne, sinon la moyenne de la nuit.
        let j = jour_depuis(&jour_brut("2026-11-12", &json!({}), &json!({ "avgOvernightHrv": 55.0 }), &json!({ "hrvSummary": { "lastNightAvg": 63.0 } }))).unwrap().unwrap();
        assert_eq!(j.vfc, Some(63.0));
        let j = jour_depuis(&jour_brut("2026-11-12", &json!({}), &json!({ "avgOvernightHrv": 55.0 }), &Value::Null)).unwrap().unwrap();
        assert_eq!(j.vfc, Some(55.0));
    }
}

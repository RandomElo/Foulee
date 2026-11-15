//! Lecteur Nolio par le navigateur piloté (lecture seule). L'utilisateur se connecte lui-même dans une vraie fenêtre ; ensuite
//! le calendrier (prévu, réalisé, compétitions, notes) est lu avec les mêmes requêtes que la page de Nolio, depuis la page
//! connectée, à faible cadence. Rien n'est écrit sur Nolio et aucun mot de passe n'est stocké : seule la session du profil dédié sert.
//!
//! Les adresses internes viennent de l'observation d'une session réelle (docs/notes/nolio-points-d-acces.md) : elles ne sont pas
//! documentées par Nolio et peuvent changer, d'où des erreurs lisibles plutôt que des données devinées.

use crate::navigateur::Session;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const ORIGINE: &str = "https://www.nolio.io";
/// Une fenêtre de lecture couvre au plus 14 jours : une réponse courte, et un point d'étape après chacune.
const JOURS_PAR_FENETRE: i64 = 14;

// ---------- Dates (sans dépendance : algorithmes de Howard Hinnant) ----------

pub(crate) fn jours_depuis_epoque(a: i64, m: i64, j: i64) -> i64 {
    let a = if m <= 2 { a - 1 } else { a };
    let ere = a.div_euclid(400);
    let aj = a - ere * 400;
    let mp = (m + 9) % 12;
    let jda = (153 * mp + 2) / 5 + j - 1;
    let jdp = aj * 365 + aj / 4 - aj / 100 + jda;
    ere * 146097 + jdp - 719468
}

pub(crate) fn date_depuis_jours(z: i64) -> String {
    let z = z + 719468;
    let ere = z.div_euclid(146097);
    let jde = z - ere * 146097;
    let ae = (jde - jde / 1460 + jde / 36524 - jde / 146096) / 365;
    let a = ae + ere * 400;
    let jda = jde - (365 * ae + ae / 4 - ae / 100);
    let mp = (5 * jda + 2) / 153;
    let j = jda - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { a + 1 } else { a }, m, j)
}

/// « AAAA-MM-JJ » valide (jour réel du calendrier) → jours depuis 1970.
pub fn jour_de(date: &str) -> Result<i64, String> {
    let b = date.as_bytes();
    let ok = b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !ok {
        return Err(format!("date invalide : {date}"));
    }
    let (a, m, j): (i64, i64, i64) = (date[0..4].parse().unwrap(), date[5..7].parse().unwrap(), date[8..10].parse().unwrap());
    let n = jours_depuis_epoque(a, m, j);
    if !(1..=12).contains(&m) || date_depuis_jours(n) != date {
        return Err(format!("date invalide : {date}"));
    }
    Ok(n)
}

pub fn aujourd_hui() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    date_depuis_jours((s / 86400) as i64)
}

pub fn decaler(date: &str, jours: i64) -> Result<String, String> {
    Ok(date_depuis_jours(jour_de(date)? + jours))
}

/// Découpe [debut, fin] en fenêtres de 14 jours au plus, sans trou ni recouvrement.
pub fn fenetres(debut: &str, fin: &str) -> Result<Vec<(String, String)>, String> {
    let (d, f) = (jour_de(debut)?, jour_de(fin)?);
    if f < d {
        return Err("la fin précède le début".into());
    }
    let mut v = Vec::new();
    let mut a = d;
    while a <= f {
        let b = (a + JOURS_PAR_FENETRE - 1).min(f);
        v.push((date_depuis_jours(a), date_depuis_jours(b)));
        a = b + 1;
    }
    Ok(v)
}

// ---------- Ce que la page renvoie, puis ce qu'on garde ----------

/// Un événement tel que la page l'extrait : les champs de la liste de Nolio, plus le commentaire et la structure lus dans la fiche.
#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct Brut {
    pub id: String,
    pub start: String,
    pub title: Option<String>,
    pub sport: Option<String>,
    pub hour_start: Option<String>,
    pub duration: Value,
    pub distance: Value,
    pub distance_unit: Option<String>,
    pub deniv: Value,
    pub pace: Value,
    pub rpe_value: Value,
    pub feeling: Value,
    pub commentaire: Option<String>,
    pub structure: Option<String>,
    pub plafond: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct Lecture {
    pub connecte: bool,
    pub evenements: Vec<Brut>,
    pub erreurs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evenement {
    pub id: String,
    pub genre: &'static str,
    pub competition: bool,
    pub date: String,
    pub heure: Option<String>,
    pub titre: String,
    pub sport: Option<String>,
    pub duree_s: Option<i64>,
    pub distance_m: Option<f64>,
    pub deniv_m: Option<f64>,
    pub allure_s_km: Option<i64>,
    /// Vrai quand l'allure prévue est une limite haute (footing : « pas plus vite que 4'55 »), pas une allure à tenir.
    pub allure_plafond: bool,
    pub rpe_prevu: Option<i64>,
    pub ressenti: Option<i64>,
    pub rpe_percu: Option<i64>,
    pub commentaire: Option<String>,
    pub structure: Option<String>,
}

fn nombre(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let t = s.trim().replace(',', ".");
            if t.is_empty() { None } else { t.parse().ok() }
        }
        _ => None,
    }
    .filter(|x| x.is_finite())
}

fn entier_positif(v: &Value) -> Option<i64> {
    nombre(v).map(|x| x.round() as i64).filter(|&n| n > 0)
}

/// « 4:55 » → 295 secondes au kilomètre. Vide, « - » ou illisible → rien.
fn allure(v: &Value) -> Option<i64> {
    let s = v.as_str()?.trim();
    let (m, sec) = s.split_once(':')?;
    let (m, sec): (i64, i64) = (m.trim().parse().ok()?, sec.trim().parse().ok()?);
    (m >= 0 && (0..60).contains(&sec) && m + sec > 0).then_some(m * 60 + sec)
}

fn texte_non_vide(s: &Option<String>) -> Option<String> {
    s.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty()).map(str::to_string)
}

pub fn normaliser(b: Brut) -> Result<Evenement, String> {
    let (prefixe, numero) = b.id.split_once('-').ok_or_else(|| format!("identifiant Nolio illisible : {}", b.id))?;
    if numero.is_empty() || !numero.bytes().all(|c| c.is_ascii_digit()) {
        return Err(format!("identifiant Nolio illisible : {}", b.id));
    }
    let (genre, competition) = match prefixe {
        "tp" => ("prevu", false),
        "cp" => ("prevu", true),
        "t" => ("reel", false),
        "c" => ("reel", true),
        "np" | "n" => ("note", false),
        autre => return Err(format!("type d'événement Nolio inconnu : {autre}")),
    };
    let date = b.start.get(..10).ok_or_else(|| format!("date illisible : {}", b.start))?;
    jour_de(date)?;
    let metres = match (b.distance_unit.as_deref().unwrap_or("km").trim(), nombre(&b.distance)) {
        ("km", Some(d)) => Some(d * 1000.0),
        ("mi", Some(d)) => Some(d * 1609.344),
        _ => None,
    };
    Ok(Evenement {
        id: b.id.clone(),
        genre,
        competition,
        date: date.to_string(),
        heure: texte_non_vide(&b.hour_start),
        titre: b.title.as_deref().unwrap_or("").trim().to_string(),
        sport: texte_non_vide(&b.sport),
        duree_s: nombre(&b.duration).map(|x| x.round() as i64).filter(|&n| n > 0),
        distance_m: metres.filter(|&m| m > 0.0),
        deniv_m: nombre(&b.deniv),
        allure_s_km: allure(&b.pace),
        allure_plafond: b.plafond,
        // Sur le prévu, rpe_value est l'effort estimé par le coach ; sur le réalisé, c'est ce que l'athlète a répondu (0 = pas de réponse).
        rpe_prevu: if genre == "prevu" { entier_positif(&b.rpe_value) } else { None },
        ressenti: if genre == "reel" { entier_positif(&b.feeling) } else { None },
        rpe_percu: if genre == "reel" { entier_positif(&b.rpe_value) } else { None },
        commentaire: texte_non_vide(&b.commentaire),
        structure: texte_non_vide(&b.structure),
    })
}

// ---------- Base ----------

/// L'état utile d'une ligne, pour savoir si une relecture a vraiment changé quelque chose (la date de lecture ne compte pas).
fn instantane(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT genre || '|' || competition || '|' || date || '|' || coalesce(heure,'') || '|' || titre || '|' || coalesce(sport,'') || '|' || coalesce(duree_s,'') || '|' || coalesce(distance_m,'') || '|' || coalesce(deniv_m,'') || '|' || coalesce(allure_s_km,'') || '|' || allure_plafond || '|' || coalesce(rpe_prevu,'') || '|' || coalesce(ressenti,'') || '|' || coalesce(rpe_percu,'') || '|' || coalesce(commentaire,'') || '|' || coalesce(structure,'') FROM nolio_evenements WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .ok()
}

/// Écrit les événements (un identifiant Nolio donne une ligne : relire met à jour). Rend (nouveaux, modifiés).
pub fn enregistrer(conn: &Connection, evenements: &[Evenement], lu_le: &str) -> Result<(usize, usize), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (mut nouveaux, mut modifies) = (0, 0);
    for e in evenements {
        let avant = instantane(&tx, &e.id);
        tx.execute(
            "INSERT INTO nolio_evenements (id, genre, competition, date, heure, titre, sport, duree_s, distance_m, deniv_m, allure_s_km, allure_plafond, rpe_prevu, ressenti, rpe_percu, commentaire, structure, lu_le)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
             ON CONFLICT(id) DO UPDATE SET genre=excluded.genre, competition=excluded.competition, date=excluded.date, heure=excluded.heure, titre=excluded.titre, sport=excluded.sport,
                duree_s=excluded.duree_s, distance_m=excluded.distance_m, deniv_m=excluded.deniv_m, allure_s_km=excluded.allure_s_km, allure_plafond=excluded.allure_plafond,
                rpe_prevu=excluded.rpe_prevu, ressenti=excluded.ressenti, rpe_percu=excluded.rpe_percu,
                commentaire=coalesce(excluded.commentaire, nolio_evenements.commentaire),
                structure=coalesce(excluded.structure, nolio_evenements.structure), lu_le=excluded.lu_le",
            params![
                e.id, e.genre, e.competition, e.date, e.heure, e.titre, e.sport, e.duree_s, e.distance_m, e.deniv_m, e.allure_s_km, e.allure_plafond,
                e.rpe_prevu, e.ressenti, e.rpe_percu, e.commentaire, e.structure, lu_le
            ],
        )
        .map_err(|x| format!("écriture de {} : {x}", e.id))?;
        match avant {
            None => nouveaux += 1,
            Some(a) if instantane(&tx, &e.id).as_deref() != Some(a.as_str()) => modifies += 1,
            Some(_) => {}
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((nouveaux, modifies))
}

// ---------- Script évalué dans la page de Nolio ----------

const SCRIPT: &str = r#"(async () => {
  const H = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const meta = document.querySelector('meta[name="user_id"]');
  let connecte = false;
  try { const t = await fetch("/ui/calendar/", { headers: H, redirect: "manual" }); connecte = t.type !== "opaqueredirect" && t.ok; } catch (e) {}
  if (!connecte || !meta || !/^\d+$/.test(meta.content)) return { connecte: false, evenements: [], erreurs: [] };
  const athlete = meta.content;
  const erreurs = [];
  const liste = async (k) => {
    const r = await fetch(`/calendar/events/${k}/?date_start=__DEBUT__&date_end=__FIN__&event_mode=sports&treeview_ids%5B%5D=${athlete}&treeview_prefix%5B%5D=a&mobile=false&is_table_view=false&frame_plan_id=0`, { headers: H });
    if (!r.ok) throw new Error(`liste ${k} : HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(`liste ${k} : réponse inattendue`);
    return j;
  };
  const MODELES = { tp: "nolio.TrainingPlanned", t: "nolio.Training", cp: "nolio.CompetitionPlanned", c: "nolio.Competition", np: "nolio.NotePlanned", n: "nolio.Note" };
  const propre = (s) => s.replace(/[​‌‍﻿]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const sansCode = (n) => { const c = n.cloneNode(true); c.querySelectorAll("script, style, wb-step, wb-key").forEach((x) => x.remove()); return c; };
  const evenements = [];
  const tous = [...(await liste("prev")), ...(await liste("real"))];
  const vus = new Set();
  for (const e of tous) {
    if (!e || typeof e.id !== "string" || vus.has(e.id)) continue;
    vus.add(e.id);
    const [prefixe, num] = e.id.split("-");
    const brut = { id: e.id, start: e.start, title: e.title, sport: e.sport, hour_start: e.hour_start, duration: e.duration, distance: e.distance, distance_unit: e.distance_unit || "km", deniv: e.deniv, pace: e.pace, rpe_value: e.rpe_value, feeling: e.feeling };
    if (MODELES[prefixe] && /^\d+$/.test(num || "") && String(e.start).slice(0, 10) <= "__FICHES__") {
      try {
        const q = `?id=${num}&event_type=${prefixe}&action=showcase&frame_plan_id=0&treeview_ids%5B%5D=${athlete}&treeview_prefix%5B%5D=a`;
        const r = await fetch(`/event/showcase/${MODELES[prefixe]}/${num}/${q}`, { headers: H });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const doc = new DOMParser().parseFromString((await r.json()).template || "", "text/html");
        if (e.is_note) {
          brut.commentaire = propre(sansCode(doc.body).textContent).slice(0, 4000) || null;
        } else {
          const zones = [...doc.querySelectorAll(".feedback-area")].map((a) => propre(sansCode(a).textContent)).filter(Boolean);
          brut.commentaire = zones.length ? zones.join("\n\n") : null;
        }
        if (prefixe === "tp") {
          const w = await fetch(`/statistic/charts/event/${num}/wb/planned/`, { headers: H });
          if (w.ok) {
            const d = (await w.json()).wb_data;
            if (Array.isArray(d)) {
              // Plafond = toutes les étapes d'allure sont « pas plus vite que » (borne basse 0) : un footing. Un fractionné a au moins une étape bornée.
              const pas = d.filter((s) => s && s.node_type === "step" && /min\/km|km\/h/.test(s.unit || ""));
              brut.plafond = pas.length > 0 && pas.every((s) => s.it === "range" && s.value_inf === 0);
              brut.structure = JSON.stringify(d.map((s) => ({ nom: s.name, type: s.node_type, unite: s.unit, valeur: s.y_value, inf: s.value_inf, duree: s.nptimeinfo_data, distance: s.npdistinfo_data })));
            }
          }
        }
      } catch (err) { erreurs.push(`${e.id} : ${err.message}`); }
      await pause(300);
    }
    evenements.push(brut);
  }
  return { connecte: true, evenements, erreurs };
})()"#;

/// Le script d'une fenêtre. Les dates sont validées avant d'être insérées : rien d'autre n'entre dans le code évalué.
pub fn script_fenetre(debut: &str, fin: &str, fiches_jusqu_a: &str) -> Result<String, String> {
    jour_de(debut)?;
    jour_de(fin)?;
    jour_de(fiches_jusqu_a)?;
    Ok(SCRIPT.replace("__DEBUT__", debut).replace("__FIN__", fin).replace("__FICHES__", fiches_jusqu_a))
}

// ---------- Connexion et synchronisation ----------

/// Connecte Nolio avec l'e-mail et le mot de passe saisis dans l'appli, dans un navigateur sans fenêtre. Le mot de passe ne sert qu'à remplir le formulaire
/// de Nolio : il n'est écrit nulle part, seule la session du profil du navigateur reste. Rend une erreur claire si Nolio refuse ou ne répond pas.
pub fn connecter(exe: &Path, profil: &Path, origine: &str, email: &str, mot_de_passe: &str, annule: &AtomicBool, delai: Duration) -> Result<(), String> {
    let mut s = crate::navigateur::lancer(exe, profil, false, &format!("{origine}/login/"))?;
    let r = connecter_dans(&mut s, origine, email, mot_de_passe, annule, delai);
    s.fermer();
    r
}

/// Vrai si la session répond sur la page du calendrier, ouverte dans un onglet à part.
fn connecte_par_onglet(s: &mut Session, origine: &str) -> bool {
    let Ok(script) = script_fenetre("2026-01-05", "2026-01-05", "2000-01-01") else { return false };
    let Ok(v) = s.evaluer(&format!("{origine}/calendar/"), &script) else { return false };
    serde_json::from_value::<Lecture>(v).map(|l| l.connecte).unwrap_or(false)
}

fn connecter_dans(s: &mut Session, origine: &str, email: &str, mot_de_passe: &str, annule: &AtomicBool, delai: Duration) -> Result<(), String> {
    let login = format!("{origine}/login");
    let hors_login = |s: &mut Session| s.urls_pages().map(|u| !u.is_empty() && u.iter().all(|x| !x.starts_with(&login))).unwrap_or(false);
    // 1. La session du profil est peut-être déjà valide ; sinon le formulaire s'affiche.
    if connecte_par_onglet(s, origine) {
        return Ok(());
    }
    let arrivee = crate::strava::attendre(annule, delai, || {
        if let Ok(Some(v)) = s.evaluer_sur_page(origine, "!!document.querySelector('#id_username') && !!document.querySelector('#id_password')") {
            if v == serde_json::json!(true) {
                return Some(false);
            }
        }
        (hors_login(s) && connecte_par_onglet(s, origine)).then_some(true)
    })?;
    match arrivee {
        Some(true) => return Ok(()),
        Some(false) => {}
        None => return Err("la page de connexion de Nolio ne s'est pas affichée".into()),
    }
    // 2. Les identifiants entrent dans le formulaire (valeurs encodées en JSON : rien d'autre n'est inséré dans le script).
    let remplir = format!(
        "(() => {{ {}\n const u = document.querySelector('#id_username'), p = document.querySelector('#id_password'); if (!u || !p) return false; remplir(u, {}); remplir(p, {}); valider(p); return true; }})()",
        crate::strava::REMPLIR,
        serde_json::to_string(email).unwrap_or_default(),
        serde_json::to_string(mot_de_passe).unwrap_or_default()
    );
    if s.evaluer_sur_page(origine, &remplir)? != Some(serde_json::json!(true)) {
        return Err("formulaire de connexion de Nolio introuvable".into());
    }
    // 3. Nolio ouvre la session (la page quitte /login), ou affiche un refus.
    let mut erreur_vue: Option<String> = None;
    let fin = crate::strava::attendre(annule, delai, || {
        if hors_login(s) {
            return connecte_par_onglet(s, origine).then_some(Ok(()));
        }
        let script = "(() => { const e = document.querySelector('.errorlist, .alert, [role=alert]'); return e && (e.offsetParent || e.getClientRects().length) ? (e.innerText || '').trim().slice(0, 200) : null; })()";
        if let Ok(Some(v)) = s.evaluer_sur_page(origine, script) {
            if let Some(t) = v.as_str().filter(|t| !t.is_empty()) {
                if erreur_vue.as_deref() == Some(t) {
                    return Some(Err(format!("Nolio a refusé la connexion : {t}")));
                }
                erreur_vue = Some(t.to_string());
            }
        }
        None
    })?;
    fin.unwrap_or_else(|| Err("Nolio n'a pas ouvert la session à temps : vérifie l'e-mail et le mot de passe".into()))
}

/// Vrai si la page du calendrier est ouverte ET que la session répond. Se fait dans la page de l'utilisateur, sans ouvrir d'onglet :
/// un second onglet lui redemanderait ses identifiants pendant qu'il se connecte.
// ---------- Écriture du RPE (option) ----------

/// Renvoie à Nolio le formulaire de la séance réalisée avec le seul `t-rpe` changé, comme le fait la carte « Feeling » du site (observé le 2026-11-15,
/// voir docs/notes/nolio-points-d-acces.md). Le formulaire est relu après l'envoi : on ne dit « fait » que si Nolio affiche bien la nouvelle valeur.
const SCRIPT_RPE: &str = r#"(async () => {
  const H = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
  const url = "/event/update/Training/__ID__/";
  const lire = async () => {
    const r = await fetch(url, { headers: H, redirect: "manual" });
    if (r.type === "opaqueredirect") return null;
    if (!r.ok) throw new Error(`formulaire : HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString((await r.json()).template || "", "text/html");
    const f = doc.querySelector("form");
    if (!f) throw new Error("formulaire introuvable");
    return f;
  };
  const f = await lire();
  if (!f) return { connecte: false, rpe: null };
  const champ = f.querySelector('[name="t-rpe"]');
  if (!champ) throw new Error("champ RPE introuvable");
  champ.value = "__RPE__";
  const donnees = new URLSearchParams();
  for (const [k, v] of new FormData(f)) donnees.append(k, String(v));
  // Comme le site : la date de début porte l'heure.
  const date = donnees.get("t-date_start") || "";
  const heure = (donnees.get("t-hour_start") || "").slice(0, 5);
  if (date.length === 10 && heure) donnees.set("t-date_start", `${date} ${heure}`);
  const cookie = (document.cookie.split("; ").find((c) => c.startsWith("csrftoken=")) || "").slice(10);
  const jeton = cookie || donnees.get("csrfmiddlewaretoken") || "";
  const r = await fetch(url, { method: "POST", headers: { ...H, "X-CSRFToken": jeton, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: donnees.toString() });
  if (!r.ok) throw new Error(`envoi : HTTP ${r.status}`);
  const apres = await lire();
  return { connecte: true, rpe: apres ? apres.querySelector('[name="t-rpe"]').value : null };
})()"#;

/// Le script d'envoi, avec l'identifiant Nolio (chiffres seulement) et le RPE (1 à 10) validés avant de les glisser dans le code.
pub fn script_rpe(id: i64, rpe: i64) -> Result<String, String> {
    if id <= 0 {
        return Err("identifiant de séance Nolio invalide".into());
    }
    if !(1..=10).contains(&rpe) {
        return Err("le RPE doit être entre 1 et 10".into());
    }
    Ok(SCRIPT_RPE.replace("__ID__", &id.to_string()).replace("__RPE__", &rpe.to_string()))
}

/// La séance réalisée de Nolio (identifiant `t-<numéro>`) qui correspond à une activité : même jour, heure la plus proche (à 2 h près), ou la seule du jour
/// si Nolio n'en donne pas l'heure. Les compétitions (`c-`) ne s'écrivent pas par ce formulaire.
pub fn choisir_seance(conn: &Connection, date: &str, heure: Option<&str>) -> Result<i64, String> {
    jour_de(date)?;
    let minutes = |h: &str| -> Option<i64> {
        let (a, b) = h.split_once(':')?;
        Some(a.trim().parse::<i64>().ok()? * 60 + b.get(..2).unwrap_or(b).trim().parse::<i64>().ok()?)
    };
    let mut r = conn.prepare("SELECT id, heure FROM nolio_evenements WHERE genre = 'reel' AND date = ?1 AND id LIKE 't-%'").map_err(|e| e.to_string())?;
    let lignes: Vec<(String, Option<String>)> = r.query_map([date], |l| Ok((l.get(0)?, l.get(1)?))).map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    let voulue = heure.and_then(minutes);
    let numero = |id: &str| id.strip_prefix("t-").and_then(|n| n.parse::<i64>().ok());
    let choix = match (lignes.as_slice(), voulue) {
        ([], _) => None,
        ([seule], None) => numero(&seule.0),
        (plusieurs, Some(v)) => plusieurs.iter().filter_map(|(id, h)| Some((numero(id)?, (minutes(h.as_deref()?)? - v).abs()))).filter(|(_, ecart)| *ecart <= 120).min_by_key(|(_, ecart)| *ecart).map(|(n, _)| n)
            .or_else(|| if let [(id, None)] = plusieurs { numero(id) } else { None }),
        _ => None,
    };
    choix.ok_or_else(|| "Aucune séance Nolio ne correspond à cette séance : lance « Synchroniser » dans Sources".to_string())
}

/// Écrit le RPE d'une séance réalisée sur Nolio (navigateur sans fenêtre, session du profil). Erreur claire si la session a expiré ou si Nolio n'a pas gardé la valeur.
pub fn ecrire_rpe(exe: &Path, profil: &Path, origine: &str, id: i64, rpe: i64) -> Result<(), String> {
    let script = script_rpe(id, rpe)?;
    let mut s = crate::navigateur::lancer(exe, profil, false, "about:blank")?;
    let r = s.evaluer(&format!("{origine}/calendar/"), &script);
    s.fermer();
    let v = r?;
    if v["connecte"].as_bool() != Some(true) {
        return Err("Nolio n'est plus connecté : reconnecte-toi depuis Sources".into());
    }
    if v["rpe"].as_str() != Some(&rpe.to_string()) {
        return Err(format!("Nolio n'a pas gardé le RPE (il affiche {})", v["rpe"].as_str().unwrap_or("rien")));
    }
    Ok(())
}

#[cfg(test)]
pub fn verifier_connexion(s: &mut Session, origine: &str) -> bool {
    let Ok(script) = script_fenetre("2026-01-05", "2026-01-05", "2000-01-01") else { return false };
    let Ok(Some(v)) = s.evaluer_sur_page(&format!("{origine}/calendar"), &script) else { return false };
    serde_json::from_value::<Lecture>(v).map(|l| l.connecte).unwrap_or(false)
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Bilan {
    pub fenetres: usize,
    pub nouveaux: usize,
    pub modifies: usize,
    pub erreurs: Vec<String>,
}

/// Lit [debut, fin] sans fenêtre, une fenêtre de 14 jours à la fois. `enregistrer_fn` écrit chaque lot (la base reste utilisable pendant la lecture),
/// `progression(fait, total)` informe l'interface. Les fiches (commentaire, structure) ne sont lues que jusqu'à `fiches_jusqu_a`.
pub fn synchroniser(
    exe: &Path,
    profil: &Path,
    origine: &str,
    debut: &str,
    fin: &str,
    fiches_jusqu_a: &str,
    annule: &AtomicBool,
    mut enregistrer_fn: impl FnMut(&[Evenement]) -> Result<(usize, usize), String>,
    mut progression: impl FnMut(usize, usize),
) -> Result<Bilan, String> {
    let lots = fenetres(debut, fin)?;
    let mut s = crate::navigateur::lancer(exe, profil, false, "about:blank")?;
    let mut bilan = Bilan::default();
    let total = lots.len();
    let mut i = 0;
    let mut suivant = |dernier: Option<Value>, bilan: &mut Bilan| -> Result<Option<String>, String> {
        if let Some(v) = dernier {
            let lecture: Lecture = serde_json::from_value(v).map_err(|e| format!("réponse de Nolio illisible : {e}"))?;
            if !lecture.connecte {
                return Err("Nolio n'est plus connecté : reconnecte-toi depuis Sources".into());
            }
            bilan.erreurs.extend(lecture.erreurs);
            let mut evs = Vec::new();
            for b in lecture.evenements {
                let id = b.id.clone();
                match normaliser(b) {
                    Ok(e) => evs.push(e),
                    Err(m) => bilan.erreurs.push(format!("{id} : {m}")),
                }
            }
            let (n, m) = enregistrer_fn(&evs)?;
            bilan.nouveaux += n;
            bilan.modifies += m;
            bilan.fenetres += 1;
            progression(i, total);
        }
        if annule.load(Ordering::SeqCst) {
            return Err("synchronisation annulée".into());
        }
        let Some((d, f)) = lots.get(i) else { return Ok(None) };
        i += 1;
        script_fenetre(d, f, fiches_jusqu_a).map(Some)
    };
    let r = s.evaluer_en_serie(&format!("{origine}/calendar/"), &mut |v| suivant(v, &mut bilan));
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

    fn brut(v: Value) -> Brut {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn les_dates_sont_validees_et_les_fenetres_couvrent_tout_sans_trou() {
        assert_eq!(jour_de("1970-01-01").unwrap(), 0);
        assert_eq!(decaler("2026-11-14", 1).unwrap(), "2026-11-15");
        assert_eq!(decaler("2026-12-31", 1).unwrap(), "2027-01-01");
        assert_eq!(decaler("2028-02-28", 1).unwrap(), "2028-02-29");
        assert_eq!(decaler("2027-02-28", 1).unwrap(), "2027-03-01");
        for mauvaise in ["2026-13-01", "2026-02-30", "26-11-14", "2026-11-14T00", "2026/11/14", "", "2026-11-1a", "'; alert(1)//"] {
            assert!(jour_de(mauvaise).is_err(), "{mauvaise} aurait dû être refusée");
        }
        let f = fenetres("2026-11-01", "2026-12-07").unwrap();
        assert_eq!(f.first().unwrap().0, "2026-11-01");
        assert_eq!(f.last().unwrap().1, "2026-12-07");
        for w in f.windows(2) {
            assert_eq!(decaler(&w[0].1, 1).unwrap(), w[1].0, "trou ou recouvrement entre deux fenêtres");
        }
        assert!(f.iter().all(|(a, b)| jour_de(b).unwrap() - jour_de(a).unwrap() < JOURS_PAR_FENETRE));
        assert_eq!(fenetres("2026-11-14", "2026-11-14").unwrap().len(), 1);
        assert!(fenetres("2026-11-14", "2026-11-13").is_err());
        assert_eq!(aujourd_hui().len(), 10);
    }

    #[test]
    fn le_script_refuse_toute_date_qui_n_en_est_pas_une() {
        assert!(script_fenetre("2026-11-01", "2026-11-14", "2026-11-21").unwrap().contains("date_start=2026-11-01"));
        assert!(script_fenetre("2026-11-01\"; fetch('//x')//", "2026-11-14", "2026-11-21").is_err());
        assert!(script_fenetre("2026-11-01", "2026-11-14", "x").is_err());
    }

    #[test]
    fn une_seance_prevue_et_une_realisee_sont_lues_comme_nolio_les_donne() {
        let prevue = normaliser(brut(json!({
            "id": "tp-37165882", "start": "2026-11-03T00:00:00", "title": "Footing", "sport": "Running", "hour_start": "",
            "duration": 2952, "distance": "10.0 ", "distance_unit": "km", "deniv": "", "pace": "4:55", "rpe_value": 2, "plafond": true,
            "commentaire": "  Sensation de facilité  ", "structure": "[]"
        })))
        .unwrap();
        assert_eq!((prevue.genre, prevue.competition, prevue.date.as_str()), ("prevu", false, "2026-11-03"));
        assert_eq!((prevue.duree_s, prevue.distance_m, prevue.allure_s_km, prevue.deniv_m), (Some(2952), Some(10000.0), Some(295), None));
        assert!(prevue.allure_plafond);
        // Sur le prévu, le 2 est l'effort estimé par le coach, pas la réponse de l'athlète.
        assert_eq!((prevue.rpe_prevu, prevue.rpe_percu, prevue.ressenti), (Some(2), None, None));
        assert_eq!(prevue.commentaire.as_deref(), Some("Sensation de facilité"));
        assert_eq!(prevue.heure, None);

        let reelle = normaliser(brut(json!({
            "id": "t-115501739", "start": "2026-11-03T00:00:00", "title": "Footing", "sport": "Running", "hour_start": "07:29",
            "duration": 3067, "distance": "9.78 ", "deniv": "108.0 ", "pace": "5:14", "rpe_value": 5, "feeling": 3
        })))
        .unwrap();
        assert_eq!((reelle.genre, reelle.heure.as_deref()), ("reel", Some("07:29")));
        assert_eq!((reelle.rpe_percu, reelle.ressenti, reelle.rpe_prevu), (Some(5), Some(3), None));
        assert_eq!((reelle.deniv_m, reelle.distance_m), (Some(108.0), Some(9780.0)));
    }

    #[test]
    fn pas_de_reponse_de_l_athlete_veut_dire_rien_et_pas_zero() {
        // Nolio met 0 quand l'athlète n'a rien répondu : on ne doit jamais l'afficher comme un effort de 0.
        let e = normaliser(brut(json!({ "id": "t-1", "start": "2026-11-14T00:00:00", "rpe_value": 0, "feeling": 0 }))).unwrap();
        assert_eq!((e.rpe_percu, e.ressenti), (None, None));
        let e = normaliser(brut(json!({ "id": "cp-2", "start": "2026-11-15T00:00:00", "rpe_value": "" }))).unwrap();
        assert_eq!((e.genre, e.competition, e.rpe_prevu), ("prevu", true, None));
    }

    #[test]
    fn les_notes_sans_sport_ni_duree_et_les_cas_tordus_ne_plantent_pas() {
        let n = normaliser(brut(json!({ "id": "np-11100879", "start": "2026-09-29T00:00:00", "title": "Spé semi" }))).unwrap();
        assert_eq!((n.genre, n.duree_s, n.distance_m, n.sport), ("note", None, None, None));
        // Allures absentes ou absurdes, distance en miles, valeurs de mauvais type.
        for pace in [json!(""), json!("-"), json!("4:75"), json!("abc"), json!(null), json!(295), json!("0:00")] {
            let e = normaliser(brut(json!({ "id": "t-3", "start": "2026-11-01T00:00:00", "pace": pace }))).unwrap();
            assert_eq!(e.allure_s_km, None);
        }
        let m = normaliser(brut(json!({ "id": "t-3", "start": "2026-11-01T00:00:00", "distance": "1.0", "distance_unit": "mi" }))).unwrap();
        assert!((m.distance_m.unwrap() - 1609.344).abs() < 1e-9);
        let inconnue = normaliser(brut(json!({ "id": "t-3", "start": "2026-11-01T00:00:00", "distance": "1.0", "distance_unit": "lieues" }))).unwrap();
        assert_eq!(inconnue.distance_m, None);
        for mauvais in [
            json!({ "id": "", "start": "2026-11-01T00:00:00" }),
            json!({ "id": "x-12", "start": "2026-11-01T00:00:00" }),
            json!({ "id": "t-abc", "start": "2026-11-01T00:00:00" }),
            json!({ "id": "t-12", "start": "bientôt" }),
            json!({ "id": "t-12", "start": "2026-02-30T00:00:00" }),
        ] {
            assert!(normaliser(brut(mauvais.clone())).is_err(), "{mauvais} aurait dû être refusé");
        }
    }

    fn base_memoire() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::base::MIGRATIONS.iter().find(|m| m.contains("nolio_evenements")).expect("migration introuvable")).unwrap();
        c
    }

    fn evenement(id: &str, titre: &str) -> Evenement {
        normaliser(brut(json!({ "id": id, "start": "2026-11-03T00:00:00", "title": titre, "duration": 3000, "distance": "10" }))).unwrap()
    }

    #[test]
    fn relire_le_meme_evenement_met_a_jour_sans_doublon_et_garde_le_commentaire_deja_lu() {
        let c = base_memoire();
        let mut e = evenement("tp-1", "Footing");
        e.commentaire = Some("Mot du coach".into());
        assert_eq!(enregistrer(&c, &[e, evenement("t-2", "Footing")], "2026-11-14T10:00").unwrap(), (2, 0));
        // Même contenu : ni nouveau, ni modifié.
        assert_eq!(enregistrer(&c, &[evenement("t-2", "Footing")], "2026-11-14T11:00").unwrap(), (0, 0));
        // Relecture hors zone des fiches (sans commentaire) : le commentaire déjà lu est conservé.
        assert_eq!(enregistrer(&c, &[evenement("tp-1", "Footing")], "2026-11-14T11:00").unwrap(), (0, 0));
        let com: Option<String> = c.query_row("SELECT commentaire FROM nolio_evenements WHERE id='tp-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(com.as_deref(), Some("Mot du coach"));
        // Un vrai changement (titre) est compté, sans créer de deuxième ligne.
        assert_eq!(enregistrer(&c, &[evenement("t-2", "Footing facile")], "2026-11-14T12:00").unwrap(), (0, 1));
        let n: i64 = c.query_row("SELECT count(*) FROM nolio_evenements", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn la_seance_nolio_est_choisie_par_jour_et_heure_les_competitions_et_les_autres_jours_sont_ignores() {
        let c = base_memoire();
        let mut a = evenement("t-11", "Matin");
        a.genre = "reel";
        a.heure = Some("08:09".into());
        let mut b = evenement("t-12", "Soir");
        b.genre = "reel";
        b.heure = Some("18:30".into());
        let mut comp = evenement("c-13", "Course");
        comp.genre = "reel";
        comp.heure = Some("08:10".into());
        enregistrer(&c, &[a, b, comp], "2026-11-14T10:00").unwrap();
        assert_eq!(choisir_seance(&c, "2026-11-03", Some("08:15")).unwrap(), 11);
        assert_eq!(choisir_seance(&c, "2026-11-03", Some("18:00")).unwrap(), 12);
        assert!(choisir_seance(&c, "2026-11-03", Some("13:00")).is_err(), "à plus de 2 h de toutes les séances");
        assert!(choisir_seance(&c, "2026-11-03", None).is_err(), "deux séances sans heure : on ne devine pas");
        assert!(choisir_seance(&c, "2026-11-04", Some("08:09")).is_err(), "autre jour");
        assert!(choisir_seance(&c, "pas une date", None).is_err());
    }

    #[test]
    fn la_base_refuse_un_genre_inconnu() {
        let c = base_memoire();
        assert!(c.execute("INSERT INTO nolio_evenements (id, genre, date, lu_le) VALUES ('x','autre','2026-11-01','')", []).is_err());
    }

    /// Manuel : `FOULEE_NOLIO_JSON=/chemin/lecture.json cargo test lecture_reelle -- --ignored`. Passe une vraie réponse du script (enregistrée
    /// depuis une session réelle, donnée personnelle : hors du dépôt) dans la normalisation et la base, pour vérifier qu'aucun événement réel n'est refusé.
    #[test]
    #[ignore]
    fn lecture_reelle_normalisable() {
        let chemin = std::env::var("FOULEE_NOLIO_JSON").expect("FOULEE_NOLIO_JSON manquant");
        let lecture: Lecture = serde_json::from_str(&std::fs::read_to_string(chemin).unwrap()).unwrap();
        assert!(lecture.connecte && !lecture.evenements.is_empty());
        let total = lecture.evenements.len();
        let mut evs = Vec::new();
        for b in lecture.evenements {
            let id = b.id.clone();
            evs.push(normaliser(b).unwrap_or_else(|e| panic!("{id} refusé : {e}")));
        }
        let c = base_memoire();
        assert_eq!(enregistrer(&c, &evs, "test").unwrap(), (total, 0));
        let par_genre = |g: &str| -> i64 { c.query_row("SELECT count(*) FROM nolio_evenements WHERE genre = ?1", [g], |r| r.get(0)).unwrap() };
        eprintln!("{total} événements : {} prévus, {} réalisés, {} notes", par_genre("prevu"), par_genre("reel"), par_genre("note"));
        let plafonds: i64 = c.query_row("SELECT count(*) FROM nolio_evenements WHERE allure_plafond = 1", [], |r| r.get(0)).unwrap();
        eprintln!("{plafonds} allures plafond");
    }

    // ---------- Bout en bout : vrai Chromium sans fenêtre contre un faux Nolio local ----------

    /// Petit serveur HTTP local qui imite les adresses de Nolio (données inventées). `connecte` : false répond comme Nolio sans session (redirection).
    fn faux_nolio(connecte: bool) -> String {
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let origine = format!("http://127.0.0.1:{}", ecoute.local_addr().unwrap().port());
        std::thread::spawn(move || {
            for flux in ecoute.incoming() {
                let Ok(mut flux) = flux else { continue };
                // Une connexion par fil : Chrome ouvre des connexions de réserve qui n'envoient rien et ne doivent pas bloquer les autres.
                std::thread::spawn(move || {
                    let mut tampon = [0u8; 4096];
                    let n = flux.read(&mut tampon).unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    let requete = String::from_utf8_lossy(&tampon[..n]).to_string();
                    let chemin = requete.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (statut, type_, corps) = reponse(&chemin, connecte);
                    let en_tete = format!("HTTP/1.1 {statut}\r\nContent-Type: {type_}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", corps.len(), if statut.starts_with("302") { "Location: /login/\r\n" } else { "" });
                    let _ = flux.write_all(en_tete.as_bytes());
                    let _ = flux.write_all(corps.as_bytes());
                });
            }
        });
        origine
    }

    /// Faux Nolio avec formulaire de connexion (champs `id_username` et `id_password`) : le mot de passe `bon` pose le cookie de session persistant,
    /// tout autre affiche une erreur. Le calendrier ne répond que si le cookie est là.
    fn faux_nolio_connexion(bon: String) -> String {
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let origine = format!("http://127.0.0.1:{}", ecoute.local_addr().unwrap().port());
        std::thread::spawn(move || {
            for flux in ecoute.incoming() {
                let Ok(mut flux) = flux else { continue };
                let bon = bon.clone();
                std::thread::spawn(move || {
                    let mut tampon = [0u8; 4096];
                    let n = flux.read(&mut tampon).unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    let requete = String::from_utf8_lossy(&tampon[..n]).to_string();
                    let chemin = requete.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let session = requete.lines().any(|l| l.to_lowercase().starts_with("cookie:") && l.contains("sid=ok"));
                    let (statut, type_, corps) = if chemin.split('?').next() == Some("/login/") {
                        let page = format!(
                            r#"<html><body><form id="login_form" onsubmit="return false"><input id="id_username" name="username" type="text"><input id="id_password" name="password" type="password"><button type="submit">Connexion</button></form>
<script>document.getElementById('login_form').onsubmit=(e)=>{{e.preventDefault(); const f=e.target;
 if(f.password.value==={bon:?} && f.username.value.includes('@')){{document.cookie='sid=ok; path=/; max-age=86400'; location='/calendar/'}}
 else {{f.insertAdjacentHTML('beforeend','<ul class=errorlist><li>Identifiants incorrects</li></ul>')}}}}</script></body></html>"#
                        );
                        ("200 OK", "text/html", page)
                    } else {
                        reponse(&chemin, session)
                    };
                    let en_tete = format!("HTTP/1.1 {statut}\r\nContent-Type: {type_}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", corps.len(), if statut.starts_with("302") { "Location: /login/\r\n" } else { "" });
                    let _ = flux.write_all(en_tete.as_bytes());
                    let _ = flux.write_all(corps.as_bytes());
                });
            }
        });
        origine
    }

    #[test]
    fn la_connexion_par_identifiants_refuse_un_mauvais_mot_de_passe_puis_garde_la_session() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let bon = "x".repeat(3) + "-essai";
        let origine = faux_nolio_connexion(bon.clone());
        let profil = dossier_test("connexion-identifiants");
        let annule = AtomicBool::new(false);
        let e = connecter(&exe, &profil, &origine, "moi@exemple.test", "faux", &annule, Duration::from_secs(30)).unwrap_err();
        assert!(e.contains("Identifiants incorrects"), "{e}");
        connecter(&exe, &profil, &origine, "moi@exemple.test", &bon, &annule, Duration::from_secs(30)).unwrap();
        // Le profil a gardé la session : se reconnecter répond tout de suite, sans mot de passe valable.
        connecter(&exe, &profil, &origine, "moi@exemple.test", "ignore", &annule, Duration::from_secs(30)).unwrap();
        let _ = std::fs::remove_dir_all(&profil);
    }

    fn reponse(chemin: &str, connecte: bool) -> (&'static str, &'static str, String) {
        let p = chemin.split('?').next().unwrap();
        if p == "/calendar/" {
            return ("200 OK", "text/html", "<html><head><meta name=\"user_id\" content=\"111\"></head><body>calendrier</body></html>".into());
        }
        if !connecte {
            return ("302 Found", "text/plain", String::new());
        }
        let json = |v: Value| ("200 OK", "application/json", v.to_string());
        match p {
            "/ui/calendar/" => json(json!({ "calendar_0": "" })),
            "/calendar/events/prev/" => json(json!([
                { "id": "tp-1", "start": "2026-11-03T00:00:00", "title": "Footing", "sport": "Running", "duration": 2952, "distance": "10.0 ", "distance_unit": "km", "pace": "4:55", "rpe_value": 2, "is_note": false },
                { "id": "tp-4", "start": "2026-11-05T00:00:00", "title": "6x2km", "sport": "Running", "duration": 4000, "distance": "13.0 ", "pace": "4:10", "rpe_value": 8, "is_note": false },
                { "id": "np-5", "start": "2026-11-02T00:00:00", "title": "Décharge", "is_note": true },
                { "id": "cp-9", "start": "2026-11-08T00:00:00", "title": "Semi de test", "sport": "Running", "rpe_value": "", "is_competition": true }
            ])),
            "/calendar/events/real/" => json(json!([
                { "id": "t-2", "start": "2026-11-03T00:00:00", "hour_start": "07:29", "title": "Footing", "sport": "Running", "duration": 3067, "distance": "9.78 ", "pace": "5:14", "rpe_value": 5, "feeling": 3 },
                { "id": "t-3", "start": "2026-11-04T00:00:00", "title": "Footing", "sport": "Running", "duration": 1800, "distance": "5.0 ", "rpe_value": 0, "feeling": 0 }
            ])),
            "/event/showcase/nolio.TrainingPlanned/1/" => json(json!({ "template": "<div><p>Fiche</p><div class=\"feedback-area\">\u{200b}Sensation de facilité, aisance respiratoire.<wb-step id=\"a\"><wb-key>4:55</wb-key></wb-step>\u{200b}</div></div>" })),
            "/event/showcase/nolio.TrainingPlanned/4/" => json(json!({ "template": "<div>pas de mot</div>" })),
            "/statistic/charts/event/4/wb/planned/" => json(json!({ "wb_data": [
                { "node_type": "step", "it": "range", "value_inf": 0, "unit": "min/km", "y_value": 3.39, "name": "Footing" },
                { "node_type": "step", "it": "range", "value_inf": 3.39, "unit": "min/km", "y_value": 3.76, "name": "SV1" },
                { "node_type": "rep" }
            ] })),
            "/event/showcase/nolio.Training/2/" => json(json!({ "template": "<div><div class=\"feedback-area\">Bien joué.</div></div>" })),
            "/event/showcase/nolio.Training/3/" => json(json!({ "template": "<div>aucun commentaire</div>" })),
            "/event/showcase/nolio.NotePlanned/5/" => json(json!({ "template": "<div>Semaine de décharge<script>var x=1;</script></div>" })),
            "/event/showcase/nolio.CompetitionPlanned/9/" => ("500 Internal Server Error", "text/plain", "panne".into()),
            "/statistic/charts/event/1/wb/planned/" => json(json!({ "wb_data": [
                { "node_type": "step", "it": "range", "value_inf": 0, "unit": "min/km", "y_value": 3.39, "name": "Footing", "nptimeinfo_data": 2952.0 }
            ] })),
            _ => ("404 Not Found", "text/plain", "inconnu".into()),
        }
    }

    fn dossier_test(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("foulee-nolio-{}-{nom}", std::process::id()));
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

    #[test]
    fn la_synchronisation_lit_un_faux_nolio_de_bout_en_bout() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let origine = faux_nolio(true);
        let dossier = dossier_test("sync");
        let base = base_memoire();
        let mut etapes = Vec::new();
        let bilan = synchroniser(
            &exe,
            &dossier.join("profil"),
            &origine,
            "2026-11-01",
            "2026-11-10",
            "2026-11-10",
            &AtomicBool::new(false),
            |evs| enregistrer(&base, evs, "2026-11-14T10:00"),
            |fait, total| etapes.push((fait, total)),
        )
        .unwrap();
        assert_eq!(bilan.fenetres, 1);
        assert_eq!(bilan.nouveaux, 6, "{:?}", bilan);
        assert_eq!(etapes, vec![(1, 1)], "une fenêtre sur une est faite");
        // La fiche de la compétition répond 500 : l'erreur est dite, le reste est gardé.
        assert!(bilan.erreurs.iter().any(|e| e.starts_with("cp-9")), "erreurs : {:?}", bilan.erreurs);

        let ligne = |id: &str| -> (String, Option<String>, Option<i64>, Option<i64>, bool, Option<String>) {
            base.query_row("SELECT genre, commentaire, ressenti, rpe_percu, allure_plafond, structure FROM nolio_evenements WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0, r.get(5)?))).unwrap()
        };
        let prevue = ligne("tp-1");
        assert_eq!(prevue.1.as_deref(), Some("Sensation de facilité, aisance respiratoire."), "le schéma wb-step et les caractères invisibles doivent disparaître");
        assert!(prevue.4, "la limite d'allure du footing doit être reconnue");
        assert!(!ligne("tp-4").4, "un fractionné (étape bornée) n'est pas un plafond");
        assert!(prevue.5.unwrap().contains("Footing"));
        let reelle = ligne("t-2");
        assert_eq!((reelle.0.as_str(), reelle.1.as_deref(), reelle.2, reelle.3), ("reel", Some("Bien joué."), Some(3), Some(5)));
        let sans_reponse = ligne("t-3");
        assert_eq!((sans_reponse.1, sans_reponse.2, sans_reponse.3), (None, None, None));
        let note = ligne("np-5");
        assert_eq!(note.1.as_deref(), Some("Semaine de décharge"), "le script de la fiche ne doit pas finir dans le texte");

        // Relire donne les mêmes lignes, sans doublon.
        let bilan2 = synchroniser(&exe, &dossier.join("profil"), &origine, "2026-11-01", "2026-11-10", "2026-11-10", &AtomicBool::new(false), |evs| enregistrer(&base, evs, "2026-11-14T11:00"), |_, _| {}).unwrap();
        assert_eq!((bilan2.nouveaux, bilan2.modifies), (0, 0));
        let n: i64 = base.query_row("SELECT count(*) FROM nolio_evenements", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 6);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn le_script_rpe_refuse_un_rpe_ou_un_identifiant_hors_limites() {
        assert!(script_rpe(116532756, 0).is_err());
        assert!(script_rpe(116532756, 11).is_err());
        assert!(script_rpe(0, 5).is_err());
        assert!(script_rpe(-3, 5).is_err());
        let s = script_rpe(116532756, 7).unwrap();
        assert!(s.contains("/event/update/Training/116532756/") && s.contains("\"7\""));
    }

    /// Faux Nolio qui garde l'état d'une séance : le formulaire montre le RPE courant, le POST le change et garde le corps reçu.
    fn faux_nolio_ecriture(rpe_initial: i64) -> (String, std::sync::Arc<std::sync::Mutex<(i64, Vec<String>)>>) {
        let etat = std::sync::Arc::new(std::sync::Mutex::new((rpe_initial, Vec::<String>::new())));
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let origine = format!("http://127.0.0.1:{}", ecoute.local_addr().unwrap().port());
        let e = etat.clone();
        std::thread::spawn(move || {
            for flux in ecoute.incoming() {
                let Ok(mut flux) = flux else { continue };
                let e = e.clone();
                std::thread::spawn(move || {
                    let mut donnees = Vec::new();
                    let mut tampon = [0u8; 4096];
                    let (tete, corps) = loop {
                        let n = flux.read(&mut tampon).unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        donnees.extend_from_slice(&tampon[..n]);
                        let texte = String::from_utf8_lossy(&donnees).to_string();
                        if let Some(i) = texte.find("\r\n\r\n") {
                            let tete = texte[..i].to_string();
                            let longueur = tete.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                            if texte.len() >= i + 4 + longueur {
                                break (tete, texte[i + 4..i + 4 + longueur].to_string());
                            }
                        }
                    };
                    let mut mots = tete.split_whitespace();
                    let (methode, chemin) = (mots.next().unwrap_or(""), mots.next().unwrap_or("/").to_string());
                    let (statut, type_, rep) = if chemin == "/calendar/" {
                        ("200 OK", "text/html", "<html><body>calendrier</body></html>".to_string())
                    } else if chemin == "/event/update/Training/7/" && methode == "POST" {
                        let a_le_jeton = tete.to_lowercase().contains("x-csrftoken: tok");
                        let rpe = corps.split('&').find_map(|c| c.strip_prefix("t-rpe=")).and_then(|v| v.parse::<i64>().ok());
                        match (a_le_jeton, rpe) {
                            (true, Some(r)) => {
                                let mut g = e.lock().unwrap();
                                g.0 = r;
                                g.1.push(corps);
                                ("200 OK", "application/json", "{\"ok\":true}".to_string())
                            }
                            _ => ("403 Forbidden", "text/plain", "refusé".to_string()),
                        }
                    } else if chemin == "/event/update/Training/7/" {
                        let rpe = e.lock().unwrap().0;
                        let form = format!("<form method=\"post\"><input type=\"hidden\" name=\"csrfmiddlewaretoken\" value=\"tok\"><input name=\"t-name\" value=\"3x1km\"><input name=\"t-hour_start\" value=\"08:09:00\"><input name=\"t-date_start\" value=\"2026-11-13\"><input type=\"number\" name=\"t-rpe\" value=\"{rpe}\"><input type=\"radio\" name=\"t-sensation\" value=\"3\" checked><input type=\"radio\" name=\"t-sensation\" value=\"4\"><input name=\"slices-0-id\" value=\"252554267\"></form>");
                        ("200 OK", "application/json", json!({ "template": form }).to_string())
                    } else {
                        ("404 Not Found", "text/plain", "inconnu".to_string())
                    };
                    let en_tete = format!("HTTP/1.1 {statut}\r\nContent-Type: {type_}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", rep.len());
                    let _ = flux.write_all(en_tete.as_bytes());
                    let _ = flux.write_all(rep.as_bytes());
                });
            }
        });
        (origine, etat)
    }

    #[test]
    fn le_rpe_est_ecrit_sur_un_faux_nolio_sans_toucher_au_reste_du_formulaire() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let (origine, etat) = faux_nolio_ecriture(5);
        let dossier = dossier_test("rpe");
        ecrire_rpe(&exe, &dossier.join("profil"), &origine, 7, 8).unwrap();
        let g = etat.lock().unwrap();
        assert_eq!(g.0, 8);
        assert_eq!(g.1.len(), 1, "un seul envoi");
        let corps = &g.1[0];
        for attendu in ["t-name=3x1km", "t-sensation=3", "slices-0-id=252554267", "t-date_start=2026-11-13+08%3A09", "csrfmiddlewaretoken=tok", "t-rpe=8"] {
            assert!(corps.contains(attendu), "manque {attendu} dans {corps}");
        }
        assert!(!corps.contains("t-sensation=4"), "le ressenti de Nolio ne doit pas changer");
        drop(g);
        // Une séance inconnue donne une erreur dite, sans rien écrire.
        let e = ecrire_rpe(&exe, &dossier.join("profil"), &origine, 8, 6).unwrap_err();
        assert!(e.contains("HTTP 404"), "{e}");
        assert_eq!(etat.lock().unwrap().1.len(), 1);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn la_verification_de_connexion_n_ouvre_aucun_onglet_et_distingue_connecte_et_deconnecte() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        for (connecte, nom) in [(true, "verif-oui"), (false, "verif-non")] {
            let origine = faux_nolio(connecte);
            let dossier = dossier_test(nom);
            let mut s = crate::navigateur::lancer(&exe, &dossier.join("profil"), false, &format!("{origine}/calendar/")).unwrap();
            // Laisse la page se charger comme le ferait l'utilisateur.
            crate::navigateur::attendre_page_chargee(&mut s, &origine);
            let avant = s.urls_pages().unwrap().len();
            assert_eq!(verifier_connexion(&mut s, &origine), connecte);
            assert_eq!(s.urls_pages().unwrap().len(), avant, "la vérification ne doit ouvrir ni fermer d'onglet");
            s.fermer();
            let _ = std::fs::remove_dir_all(&dossier);
        }
        // Aucune page du calendrier ouverte : pas connecté, sans erreur.
        let origine = faux_nolio(true);
        let dossier = dossier_test("verif-rien");
        let mut s = crate::navigateur::lancer(&exe, &dossier.join("profil"), false, "about:blank").unwrap();
        assert!(!verifier_connexion(&mut s, &origine));
        s.fermer();
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn sans_session_la_synchronisation_s_arrete_proprement_sans_rien_ecrire() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let origine = faux_nolio(false);
        let dossier = dossier_test("deconnecte");
        let base = base_memoire();
        let r = synchroniser(&exe, &dossier.join("profil"), &origine, "2026-11-01", "2026-11-10", "2026-11-10", &AtomicBool::new(false), |evs| enregistrer(&base, evs, "x"), |_, _| {});
        let m = r.unwrap_err();
        assert!(m.contains("reconnecte"), "message inattendu : {m}");
        let n: i64 = base.query_row("SELECT count(*) FROM nolio_evenements", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        let _ = std::fs::remove_dir_all(&dossier);
    }

    #[test]
    fn une_synchronisation_annulee_s_arrete_avant_de_lire() {
        let Some(exe) = chromium_ou_ignorer() else { return };
        let origine = faux_nolio(true);
        let dossier = dossier_test("annule");
        let base = base_memoire();
        let r = synchroniser(&exe, &dossier.join("profil"), &origine, "2026-11-01", "2026-12-10", "2026-11-10", &AtomicBool::new(true), |evs| enregistrer(&base, evs, "x"), |_, _| {});
        assert!(r.unwrap_err().contains("annulée"));
        let n: i64 = base.query_row("SELECT count(*) FROM nolio_evenements", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        let _ = std::fs::remove_dir_all(&dossier);
    }
}

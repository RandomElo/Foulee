//! Navigateur piloté pour les sources sans API (Nolio, Strava) : détection d'un Chromium installé, téléchargement vérifié de
//! Chrome for Testing en secours, lancement avec un profil dédié, et évaluation de JavaScript dans une page connectée par le
//! DevTools Protocol (127.0.0.1, port aléatoire). Le navigateur ne tourne que le temps d'une tâche.
//!
//! Sécurité : sandbox de Chrome gardée, profil dédié à l'appli (jamais le profil quotidien de l'utilisateur), téléchargement
//! depuis un seul hôte en HTTPS sans redirection, version et SHA-256 épinglés dans le code, dézippage protégé contre les chemins piégés.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

/// Chrome for Testing épinglé (stable au 2026-11-14). Mettre à jour avec l'appli : version, tailles et empreintes ensemble.
pub const VERSION: &str = "157.0.8103.78";
const HOTE: &str = "https://storage.googleapis.com/chrome-for-testing-public/";

pub struct Plateforme {
    pub cft: &'static str,
    pub taille: u64,
    pub sha256: &'static str,
}

/// La plateforme courante, si Chrome for Testing existe pour elle.
pub fn plateforme() -> Option<Plateforme> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    match (os, arch) {
        ("linux", "x86_64") => Some(Plateforme { cft: "linux64", taille: 203_266_906, sha256: "9223832977a13db3646201b1341c1f9cf08afa3ceae92540116d7b0c062364fb" }),
        ("macos", "aarch64") => Some(Plateforme { cft: "mac-arm64", taille: 196_634_479, sha256: "bf3b49d0fe62a62397e98641aa736ef813c46014f03ec13d4913442e6966c7fc" }),
        ("macos", "x86_64") => Some(Plateforme { cft: "mac-x64", taille: 207_246_731, sha256: "8f9590a4e011ba4ea135f50c711f8bf2c7f32b1fac20de68d1b85f010f095ab3" }),
        ("windows", "x86_64") => Some(Plateforme { cft: "win64", taille: 209_854_321, sha256: "5f6ec40206407112702e163bf694d07f9fdc8ccbd346c70ce61fa62f716493f9" }),
        _ => None,
    }
}

fn url_telechargement(p: &Plateforme) -> String {
    format!("{HOTE}{VERSION}/{0}/chrome-{0}.zip", p.cft)
}

// ---------- Détection ----------

#[derive(Clone, Debug, serde::Serialize)]
pub struct Detecte {
    pub nom: String,
    pub chemin: String,
}

fn candidats() -> Vec<(&'static str, PathBuf)> {
    let mut v: Vec<(&'static str, PathBuf)> = Vec::new();
    match std::env::consts::OS {
        "linux" => {
            for (n, c) in [
                ("Chrome", "/usr/bin/google-chrome-stable"), ("Chrome", "/usr/bin/google-chrome"), ("Chromium", "/usr/bin/chromium"),
                ("Chromium", "/usr/bin/chromium-browser"), ("Edge", "/usr/bin/microsoft-edge"), ("Brave", "/usr/bin/brave-browser"),
            ] {
                v.push((n, PathBuf::from(c)));
            }
        }
        "macos" => {
            for (n, c) in [
                ("Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), ("Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"),
                ("Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), ("Brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            ] {
                v.push((n, PathBuf::from(c)));
            }
        }
        "windows" => {
            for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
                if let Some(base) = std::env::var_os(var) {
                    let b = PathBuf::from(base);
                    v.push(("Chrome", b.join("Google/Chrome/Application/chrome.exe")));
                    v.push(("Edge", b.join("Microsoft/Edge/Application/msedge.exe")));
                    v.push(("Brave", b.join("BraveSoftware/Brave-Browser/Application/brave.exe")));
                }
            }
        }
        _ => {}
    }
    v
}

/// Les navigateurs Chromium installés (Chrome, Chromium, Edge, Brave), sans doublon.
pub fn detecter() -> Vec<Detecte> {
    let mut out: Vec<Detecte> = Vec::new();
    for (nom, chemin) in candidats() {
        if chemin.is_file() && !out.iter().any(|d| d.chemin == chemin.to_string_lossy()) {
            out.push(Detecte { nom: nom.to_string(), chemin: chemin.to_string_lossy().into_owned() });
        }
    }
    out
}

fn racine_cft(dossier_app: &Path) -> PathBuf {
    dossier_app.join("navigateur").join("chrome-for-testing").join(VERSION)
}

fn executable_cft(dossier_app: &Path) -> Option<PathBuf> {
    let p = plateforme()?;
    let base = racine_cft(dossier_app).join(format!("chrome-{}", p.cft));
    let exe = match std::env::consts::OS {
        "windows" => base.join("chrome.exe"),
        "macos" => base.join("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        _ => base.join("chrome"),
    };
    exe.is_file().then_some(exe)
}

/// Le navigateur à utiliser : Chrome for Testing déjà téléchargé en premier (version connue), sinon un Chromium installé.
pub fn choisir(dossier_app: &Path) -> Option<Detecte> {
    if let Some(e) = executable_cft(dossier_app) {
        return Some(Detecte { nom: format!("Chrome for Testing {VERSION}"), chemin: e.to_string_lossy().into_owned() });
    }
    detecter().into_iter().next()
}

// ---------- Téléchargement vérifié ----------

pub static ANNULER: AtomicBool = AtomicBool::new(false);

/// Télécharge `url` vers `dest`, vérifie le SHA-256 pendant la lecture. Efface le fichier en cas d'échec, d'annulation ou d'empreinte fausse.
pub fn telecharger_zip(url: &str, dest: &Path, sha_attendu: &str, annule: &AtomicBool, mut progression: impl FnMut(u64, u64)) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().max_redirects(0).timeout_global(Some(Duration::from_secs(3600))).build().into();
    let reponse = agent.get(url).call().map_err(|e| format!("téléchargement impossible : {e}"))?;
    let total: u64 = reponse.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut lecteur = reponse.into_body().into_reader();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut fichier = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut tampon = vec![0u8; 256 * 1024];
    let mut recus = 0u64;
    let resultat = (|| -> Result<(), String> {
        loop {
            if annule.load(Ordering::SeqCst) {
                return Err("téléchargement annulé".into());
            }
            let n = lecteur.read(&mut tampon).map_err(|e| format!("lecture interrompue : {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&tampon[..n]);
            fichier.write_all(&tampon[..n]).map_err(|e| e.to_string())?;
            recus += n as u64;
            progression(recus, total);
        }
        let h = hex::encode(hasher.clone().finalize());
        if !h.eq_ignore_ascii_case(sha_attendu) {
            return Err("empreinte SHA-256 différente de celle attendue : fichier rejeté".into());
        }
        Ok(())
    })();
    drop(fichier);
    if resultat.is_err() {
        let _ = fs::remove_file(dest);
    }
    resultat
}

/// Dézippe dans `dest` en refusant tout chemin qui sortirait du dossier (zip-slip) et en gardant les droits d'exécution.
pub fn dezipper(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| format!("archive illisible : {e}"))?;
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entree = archive.by_index(i).map_err(|e| e.to_string())?;
        let relatif = entree.enclosed_name().ok_or_else(|| format!("chemin refusé dans l'archive : {}", entree.name()))?;
        let cible = dest.join(relatif);
        if !cible.starts_with(dest) {
            return Err(format!("chemin refusé dans l'archive : {}", entree.name()));
        }
        if entree.is_dir() {
            fs::create_dir_all(&cible).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = cible.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut sortie = fs::File::create(&cible).map_err(|e| e.to_string())?;
        std::io::copy(&mut entree, &mut sortie).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entree.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&cible, fs::Permissions::from_mode(mode & 0o755)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Télécharge Chrome for Testing dans le dossier de l'appli (étapes : zip vérifié, dézippage dans un dossier temporaire, renommage).
pub fn installer_cft(dossier_app: &Path, progression: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let p = plateforme().ok_or("Chrome for Testing n'existe pas pour ce système")?;
    ANNULER.store(false, Ordering::SeqCst);
    let racine = racine_cft(dossier_app);
    let zip_path = dossier_app.join("navigateur").join(format!("chrome-{}-{VERSION}.zip.partiel", p.cft));
    telecharger_zip(&url_telechargement(&p), &zip_path, p.sha256, &ANNULER, progression)?;
    let tmp = racine.with_extension("extraction");
    let _ = fs::remove_dir_all(&tmp);
    let r = dezipper(&zip_path, &tmp);
    let _ = fs::remove_file(&zip_path);
    r?;
    let _ = fs::remove_dir_all(&racine);
    fs::create_dir_all(racine.parent().ok_or("chemin invalide")?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &racine).map_err(|e| e.to_string())?;
    executable_cft(dossier_app).ok_or_else(|| "exécutable introuvable après installation".to_string())
}

// ---------- Lancement et DevTools Protocol ----------

pub struct Session {
    enfant: Child,
    ws: WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    suivant: u64,
    profil: PathBuf,
}

/// « port\n/chemin » écrit par Chrome dans DevToolsActivePort.
pub fn lire_port(contenu: &str) -> Option<(u16, String)> {
    let mut l = contenu.lines();
    let port = l.next()?.trim().parse().ok()?;
    let chemin = l.next()?.trim().to_string();
    (chemin.starts_with('/')).then_some((port, chemin))
}

#[cfg(test)]
fn options_de_test() -> Vec<&'static str> {
    // Les machines de CI interdisent souvent les espaces de noms utilisateur (sandbox coupée) et n'ont pas de trousseau déverrouillé
    // (cookies chiffrés avec un trousseau factice) : dans les tests seulement, jamais dans l'appli.
    vec!["--no-sandbox", "--disable-gpu", "--use-mock-keychain", "--password-store=basic"]
}
#[cfg(not(test))]
fn options_de_test() -> Vec<&'static str> {
    vec![]
}

/// Lance le navigateur avec le profil dédié. `visible` : fenêtre pour que l'utilisateur se connecte ; sinon sans fenêtre.
pub fn lancer(exe: &Path, profil: &Path, visible: bool, url: &str) -> Result<Session, String> {
    fs::create_dir_all(profil).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(profil, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let fichier_port = profil.join("DevToolsActivePort");
    let _ = fs::remove_file(&fichier_port);
    let mut cmd = Command::new(exe);
    cmd.arg(format!("--user-data-dir={}", profil.display()))
        .arg("--remote-debugging-port=0")
        .arg("--remote-debugging-address=127.0.0.1")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .args(options_de_test());
    if visible {
        // Mode application : une seule page, sans onglets ni barre d'adresse (pas de recherche possible), pour guider la connexion.
        cmd.arg(format!("--app={url}"));
    } else {
        cmd.arg("--headless=new").arg(url);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut enfant = cmd.spawn().map_err(|e| format!("lancement du navigateur impossible : {e}"))?;

    let debut = Instant::now();
    let (port, chemin) = loop {
        if let Ok(c) = fs::read_to_string(&fichier_port) {
            if let Some(x) = lire_port(&c) {
                break x;
            }
        }
        if let Ok(Some(statut)) = enfant.try_wait() {
            return Err(format!("le navigateur s'est arrêté au démarrage ({statut}) : déjà ouvert avec ce profil ?"));
        }
        if debut.elapsed() > Duration::from_secs(30) {
            let _ = enfant.kill();
            return Err("le navigateur n'a pas démarré à temps".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let (ws, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}{chemin}")).map_err(|e| {
        let _ = enfant.kill();
        format!("connexion au navigateur impossible : {e}")
    })?;
    if let MaybeTlsStream::Plain(s) = ws.get_ref() {
        let _ = s.set_read_timeout(Some(Duration::from_secs(60)));
    }
    Ok(Session { enfant, ws, suivant: 1, profil: profil.to_path_buf() })
}

/// Ouvre une vraie fenêtre (une seule page, sans onglets ni barre d'adresse) sur `url_depart` et attend que l'utilisateur soit connecté,
/// ce que décide `verifier` (qui ne doit ouvrir aucun onglet). L'appli ne remplit aucun champ. Rend `Ok(())` une fois connecté, une erreur
/// si la fenêtre est fermée, la connexion annulée ou trop longue. Le navigateur est fermé proprement dans tous les cas (cookies écrits).
pub fn connecter_fenetre(exe: &Path, profil: &Path, url_depart: &str, annule: &AtomicBool, delai: Duration, mut verifier: impl FnMut(&mut Session) -> bool) -> Result<(), String> {
    let mut s = lancer(exe, profil, true, url_depart)?;
    let debut = Instant::now();
    let resultat = loop {
        if annule.load(Ordering::SeqCst) {
            break Err("connexion annulée".to_string());
        }
        if debut.elapsed() > delai {
            break Err("connexion non terminée à temps".to_string());
        }
        match s.urls_pages() {
            Err(_) => break Err("la fenêtre a été fermée avant la connexion".to_string()),
            Ok(urls) if urls.is_empty() => break Err("la fenêtre a été fermée avant la connexion".to_string()),
            Ok(_) => {
                if verifier(&mut s) {
                    break Ok(());
                }
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    };
    s.fermer();
    resultat
}

impl Session {
    /// Envoie une commande DevTools et attend sa réponse (les événements reçus entre-temps sont ignorés).
    pub fn appeler(&mut self, methode: &str, params: Value, session_id: Option<&str>) -> Result<Value, String> {
        let id = self.suivant;
        self.suivant += 1;
        let mut msg = json!({ "id": id, "method": methode, "params": params });
        if let Some(s) = session_id {
            msg["sessionId"] = json!(s);
        }
        self.ws.send(Message::text(msg.to_string())).map_err(|e| e.to_string())?;
        loop {
            let recu = self.ws.read().map_err(|e| format!("lecture DevTools : {e}"))?;
            if let Message::Text(t) = recu {
                let v: Value = serde_json::from_str(t.as_str()).map_err(|e| e.to_string())?;
                if v["id"] == json!(id) {
                    if let Some(err) = v.get("error") {
                        return Err(format!("{methode} : {}", err["message"].as_str().unwrap_or("erreur")));
                    }
                    return Ok(v["result"].clone());
                }
            }
        }
    }

    /// Ouvre `url` dans un nouvel onglet et attend la fin du chargement. Rend (cible, session).
    fn ouvrir_onglet(&mut self, url: &str) -> Result<(String, String), String> {
        let cible = self.appeler("Target.createTarget", json!({ "url": "about:blank" }), None)?["targetId"].as_str().ok_or("onglet non créé")?.to_string();
        let sid = self.appeler("Target.attachToTarget", json!({ "targetId": cible, "flatten": true }), None)?["sessionId"].as_str().ok_or("session non créée")?.to_string();
        self.appeler("Page.enable", json!({}), Some(&sid))?;
        self.appeler("Page.navigate", json!({ "url": url }), Some(&sid))?;
        let debut = Instant::now();
        loop {
            let etat = self.appeler("Runtime.evaluate", json!({ "expression": "document.readyState", "returnByValue": true }), Some(&sid)).ok();
            if etat.as_ref().and_then(|e| e["result"]["value"].as_str()) == Some("complete") {
                return Ok((cible, sid));
            }
            if debut.elapsed() > Duration::from_secs(60) {
                let _ = self.appeler("Target.closeTarget", json!({ "targetId": cible }), None);
                return Err("la page n'a pas fini de charger".into());
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    fn evaluer_dans(&mut self, sid: &str, script: &str) -> Result<Value, String> {
        let r = self.appeler("Runtime.evaluate", json!({ "expression": script, "awaitPromise": true, "returnByValue": true }), Some(sid))?;
        if let Some(e) = r.get("exceptionDetails") {
            return Err(format!("erreur dans la page : {}", e["exception"]["description"].as_str().or(e["text"].as_str()).unwrap_or("inconnue")));
        }
        Ok(r["result"]["value"].clone())
    }

    /// Ouvre `url` dans un nouvel onglet, attend la fin du chargement, évalue `script` (une expression, promesse acceptée) et rend sa valeur JSON.
    #[allow(dead_code)] // utilisée par la vérification de connexion de nolio.rs et par les tests
    pub fn evaluer(&mut self, url: &str, script: &str) -> Result<Value, String> {
        let (cible, sid) = self.ouvrir_onglet(url)?;
        let r = self.evaluer_dans(&sid, script);
        let _ = self.appeler("Target.closeTarget", json!({ "targetId": cible }), None);
        r
    }

    /// Charge `url` une seule fois puis évalue plusieurs scripts dans la même page. `suivant` reçoit le résultat du script précédent
    /// (rien au premier appel) et rend le script suivant, ou `None` pour finir. Une erreur de `suivant` arrête la série.
    pub fn evaluer_en_serie(&mut self, url: &str, suivant: &mut dyn FnMut(Option<Value>) -> Result<Option<String>, String>) -> Result<(), String> {
        let mut script = match suivant(None)? {
            Some(s) => s,
            None => return Ok(()),
        };
        let (cible, sid) = self.ouvrir_onglet(url)?;
        let r = (|| loop {
            let v = self.evaluer_dans(&sid, &script)?;
            match suivant(Some(v))? {
                Some(s) => script = s,
                None => return Ok(()),
            }
        })();
        let _ = self.appeler("Target.closeTarget", json!({ "targetId": cible }), None);
        r
    }

    /// Évalue `script` dans la page déjà ouverte dont l'adresse commence par `prefixe`, sans ouvrir ni fermer aucun onglet.
    /// Rend `None` si aucune page ne correspond.
    pub fn evaluer_sur_page(&mut self, prefixe: &str, script: &str) -> Result<Option<Value>, String> {
        let r = self.appeler("Target.getTargets", json!({}), None)?;
        let Some(cible) = r["targetInfos"].as_array().and_then(|a| a.iter().find(|t| t["type"] == "page" && t["url"].as_str().is_some_and(|u| u.starts_with(prefixe)))).and_then(|t| t["targetId"].as_str()).map(str::to_string) else {
            return Ok(None);
        };
        let sid = self.appeler("Target.attachToTarget", json!({ "targetId": cible, "flatten": true }), None)?["sessionId"].as_str().ok_or("session non créée")?.to_string();
        let v = self.evaluer_dans(&sid, script);
        let _ = self.appeler("Target.detachFromTarget", json!({ "sessionId": sid }), None);
        v.map(Some)
    }

    /// Adresses des onglets de page ouverts (pour savoir où en est l'utilisateur pendant la connexion).
    pub fn urls_pages(&mut self) -> Result<Vec<String>, String> {
        let r = self.appeler("Target.getTargets", json!({}), None)?;
        Ok(r["targetInfos"].as_array().map(|a| a.iter().filter(|t| t["type"] == "page").filter_map(|t| t["url"].as_str().map(str::to_string)).collect()).unwrap_or_default())
    }

    pub fn version(&mut self) -> Result<String, String> {
        Ok(self.appeler("Browser.getVersion", json!({}), None)?["product"].as_str().unwrap_or("?").to_string())
    }

    /// Ferme proprement (pour que les cookies du profil soient écrits), puis s'assure que le processus a fini.
    pub fn fermer(mut self) {
        let _ = self.appeler("Browser.close", json!({}), None);
        let debut = Instant::now();
        while debut.elapsed() < Duration::from_secs(10) {
            if matches!(self.enfant.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = self.enfant.kill();
        let _ = self.enfant.wait();
        let _ = fs::remove_file(self.profil.join("DevToolsActivePort"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn dossier_test(nom: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("foulee-nav-{}-{nom}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Mini serveur HTTP : répond `corps` (avec son type) à chaque requête, dans un fil, jusqu'à la fin du test.
    fn serveur(type_mime: &'static str, corps: Vec<u8>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for flux in l.incoming().flatten() {
                let mut flux = flux;
                let mut tampon = [0u8; 2048];
                let _ = flux.read(&mut tampon);
                let tete = format!("HTTP/1.1 200 OK\r\nContent-Type: {type_mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", corps.len());
                let _ = flux.write_all(tete.as_bytes());
                let _ = flux.write_all(&corps);
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    fn zip_en_memoire(fichiers: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tampon = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut tampon);
            for (nom, contenu) in fichiers {
                z.start_file(*nom, zip::write::SimpleFileOptions::default()).unwrap();
                z.write_all(contenu).unwrap();
            }
            z.finish().unwrap();
        }
        tampon.into_inner()
    }

    #[test]
    fn le_port_devtools_se_lit() {
        assert_eq!(lire_port("43521\n/devtools/browser/abc-123\n"), Some((43521, "/devtools/browser/abc-123".to_string())));
        assert_eq!(lire_port("pas un port\n/x"), None);
        assert_eq!(lire_port("43521"), None);
        assert_eq!(lire_port("43521\nsans-slash"), None);
    }

    #[test]
    fn chaque_plateforme_a_une_empreinte_de_64_hex_et_une_url_sur_le_bon_hote() {
        for (cft, sha) in [("linux64", "9223832977a13db3646201b1341c1f9cf08afa3ceae92540116d7b0c062364fb"), ("win64", "5f6ec40206407112702e163bf694d07f9fdc8ccbd346c70ce61fa62f716493f9")] {
            assert_eq!(sha.len(), 64);
            let p = Plateforme { cft, taille: 1, sha256: sha };
            assert!(url_telechargement(&p).starts_with("https://storage.googleapis.com/chrome-for-testing-public/157."));
        }
    }

    #[test]
    fn le_telechargement_verifie_l_empreinte_et_efface_un_fichier_faux() {
        let contenu = zip_en_memoire(&[("a.txt", b"bonjour")]);
        let url = serveur("application/zip", contenu.clone());
        let dossier = dossier_test("dl");
        let bon = hex::encode(Sha256::digest(&contenu));
        let dest = dossier.join("ok.zip");
        telecharger_zip(&url, &dest, &bon, &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), contenu);
        let faux = dossier.join("faux.zip");
        let err = telecharger_zip(&url, &faux, &"0".repeat(64), &AtomicBool::new(false), |_, _| {}).unwrap_err();
        assert!(err.contains("empreinte"), "{err}");
        assert!(!faux.exists(), "un fichier à l'empreinte fausse doit être effacé");
    }

    #[test]
    fn un_telechargement_peut_etre_annule() {
        let contenu = vec![7u8; 4 * 1024 * 1024];
        let url = serveur("application/octet-stream", contenu);
        let dest = dossier_test("annule").join("x.zip");
        let err = telecharger_zip(&url, &dest, &"0".repeat(64), &AtomicBool::new(true), |_, _| {}).unwrap_err();
        assert!(err.contains("annulé"), "{err}");
        assert!(!dest.exists());
    }

    #[test]
    fn une_redirection_est_refusee() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut f in l.incoming().flatten() {
                let mut t = [0u8; 1024];
                let _ = f.read(&mut t);
                let _ = f.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/ailleurs\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        let dest = dossier_test("redir").join("x.zip");
        assert!(telecharger_zip(&format!("http://127.0.0.1:{port}/"), &dest, &"0".repeat(64), &AtomicBool::new(false), |_, _| {}).is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn le_dezippage_refuse_les_chemins_piegés_et_garde_les_dossiers() {
        let dossier = dossier_test("zip");
        let bon = dossier.join("bon.zip");
        fs::write(&bon, zip_en_memoire(&[("dir/a.txt", b"a"), ("b.txt", b"b")])).unwrap();
        dezipper(&bon, &dossier.join("sortie")).unwrap();
        assert_eq!(fs::read_to_string(dossier.join("sortie/dir/a.txt")).unwrap(), "a");
        let piege = dossier.join("piege.zip");
        fs::write(&piege, zip_en_memoire(&[("../evil.txt", b"x")])).unwrap();
        assert!(dezipper(&piege, &dossier.join("sortie2")).is_err());
        assert!(!dossier.join("evil.txt").exists());
        let absolu = dossier.join("absolu.zip");
        fs::write(&absolu, zip_en_memoire(&[("/tmp/evil-foulee.txt", b"x")])).unwrap();
        assert!(dezipper(&absolu, &dossier.join("sortie3")).is_err());
    }

    /// Test de bout en bout avec un vrai Chromium s'il y en a un (Chrome, Edge… sur les machines de CI) : sans fenêtre, évalue un fetch.
    #[test]
    fn un_chromium_installe_lit_une_page_locale_et_garde_les_cookies_du_profil() {
        let Some(nav) = detecter().into_iter().next() else {
            // Sur la CI, un navigateur est toujours présent : son absence est une panne, pas une raison d'ignorer le test.
            assert!(std::env::var_os("FOULEE_EXIGER_NAVIGATEUR").is_none(), "aucun Chromium détecté alors qu'il est exigé");
            eprintln!("(pas de Chromium installé : test de bout en bout ignoré)");
            return;
        };
        let page = serveur("text/html", b"<html><body>ok</body></html>".to_vec());
        let dossier = dossier_test("chrome");
        let profil = dossier.join("profil");

        let mut s = lancer(Path::new(&nav.chemin), &profil, false, "about:blank").unwrap();
        assert!(s.version().unwrap().contains("hrome") || s.version().unwrap().contains("dg"), "version inattendue");
        let titre = s.evaluer(&page, "document.body.innerText").unwrap();
        assert_eq!(titre, json!("ok"));
        // Un cookie persistant écrit pendant cette session…
        s.evaluer(&page, "(document.cookie = 'foulee=session1; max-age=3600; path=/', 'pose')").unwrap();
        s.fermer();

        // …doit encore être là au lancement suivant avec le même profil : c'est tout le principe de la connexion gardée.
        let mut s2 = lancer(Path::new(&nav.chemin), &profil, false, "about:blank").unwrap();
        let cookies = s2.evaluer(&page, "document.cookie").unwrap();
        s2.fermer();
        assert!(cookies.as_str().unwrap_or("").contains("foulee=session1"), "cookie perdu : {cookies}");
    }

    /// Manuel (télécharge ~200 Mo) : `cargo test installation_reelle -- --ignored`. Vérifie toute la chaîne sur le système courant :
    /// téléchargement, empreinte, dézippage, droits d'exécution, lancement sans fenêtre, version.
    #[test]
    #[ignore]
    fn installation_reelle_de_chrome_for_testing() {
        let dossier = dossier_test("reel");
        let exe = installer_cft(&dossier, |r, t| if t > 0 && r % (20 * 1024 * 1024) < 262144 { eprintln!("{} / {} Mo", r / 1_000_000, t / 1_000_000) }).unwrap();
        assert_eq!(choisir(&dossier).map(|c| c.chemin), Some(exe.to_string_lossy().into_owned()));
        let mut s = lancer(&exe, &dossier.join("profil"), false, "about:blank").unwrap();
        let v = s.version().unwrap();
        s.fermer();
        assert!(v.contains(VERSION.split('.').next().unwrap()), "version : {v}");
    }
}

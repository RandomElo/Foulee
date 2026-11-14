//! Client Garmin Connect sans navigateur, à la façon de l'appli Android (GarminAuth.kt, même flux que la bibliothèque garth) : connexion SSO mobile avec
//! l'e-mail et le mot de passe saisis dans l'appli (et le code de vérification si Garmin le demande), puis ticket de service, jeton OAuth1, jeton OAuth2
//! renouvelé à partir du jeton OAuth1. Le mot de passe sert une fois et n'est jamais gardé ; seuls les deux éléments du jeton OAuth1 sont rangés dans le
//! trousseau du système. Garmin n'a pas d'API publique pour les particuliers : ce flux peut changer à tout moment, d'où des erreurs lisibles.

use base64::Engine;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;
use std::time::Duration;

const CLIENT_ID: &str = "GCM_ANDROID_DARK";
const SERVICE: &str = "https://mobile.integration.garmin.com/gcm/android";
const UA_APP: &str = "com.garmin.android.apps.connectmobile";
const UA_WEB: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const AUDIENCE: &str = "GARMIN_CONNECT_MOBILE_ANDROID_DI";

/// Les trois hôtes utilisés (remplaçables pour les tests, qui parlent à un faux serveur local).
#[derive(Clone, Debug)]
pub struct Hotes {
    pub sso: String,
    pub api: String,
    /// Fichier public qui donne la clé et le secret « consommateur » OAuth1 de l'appli mobile de Garmin.
    pub consommateur: String,
}

impl Hotes {
    pub fn reels() -> Self {
        Hotes { sso: "https://sso.garmin.com".into(), api: "https://connectapi.garmin.com".into(), consommateur: "https://thegarth.s3.amazonaws.com/oauth_consumer.json".into() }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ErreurGarmin {
    /// Session absente, expirée ou refusée : il faut se reconnecter.
    Auth(String),
    Autre(String),
}

impl fmt::Display for ErreurGarmin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErreurGarmin::Auth(m) | ErreurGarmin::Autre(m) => f.write_str(m),
        }
    }
}

impl From<ErreurGarmin> for String {
    fn from(e: ErreurGarmin) -> String {
        e.to_string()
    }
}

fn autre(m: impl Into<String>) -> ErreurGarmin {
    ErreurGarmin::Autre(m.into())
}

fn auth(m: impl Into<String>) -> ErreurGarmin {
    ErreurGarmin::Auth(m.into())
}

/// Les deux éléments du jeton OAuth1, durables : c'est tout ce qu'on garde de la connexion.
#[derive(Clone, Debug, PartialEq)]
pub struct Jetons {
    pub oauth1_token: String,
    pub oauth1_secret: String,
}

#[derive(Debug, PartialEq)]
pub enum Connexion {
    Faite,
    /// Garmin demande un code de vérification (méthode : « email », « sms »…).
    CodeRequis(String),
}

// ---------- OAuth 1.0 (HMAC-SHA1) ----------

/// Encodage en pour-cent de la norme OAuth (RFC 3986) : seuls les caractères non réservés restent tels quels.
pub fn encoder(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn requete_encodee(params: &[(&str, &str)]) -> String {
    params.iter().map(|(k, v)| format!("{}={}", encoder(k), encoder(v))).collect::<Vec<_>>().join("&")
}

/// L'en-tête `Authorization: OAuth …`. Les paramètres de la requête et du formulaire entrent dans la signature.
#[allow(clippy::too_many_arguments)]
pub fn en_tete_oauth1(methode: &str, url: &str, requete: &[(&str, &str)], formulaire: &[(&str, &str)], consommateur: (&str, &str), jeton: Option<(&str, &str)>, nonce: &str, horodatage: i64) -> String {
    let mut oauth: BTreeMap<String, String> = BTreeMap::new();
    oauth.insert("oauth_consumer_key".into(), consommateur.0.into());
    oauth.insert("oauth_nonce".into(), nonce.into());
    oauth.insert("oauth_signature_method".into(), "HMAC-SHA1".into());
    oauth.insert("oauth_timestamp".into(), horodatage.to_string());
    oauth.insert("oauth_version".into(), "1.0".into());
    if let Some((t, _)) = jeton {
        oauth.insert("oauth_token".into(), t.into());
    }
    let mut tous: Vec<(String, String)> = oauth.iter().map(|(k, v)| (encoder(k), encoder(v))).collect();
    tous.extend(requete.iter().chain(formulaire.iter()).map(|(k, v)| (encoder(k), encoder(v))));
    tous.sort();
    let parametres = tous.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let base = format!("{}&{}&{}", methode, encoder(url), encoder(&parametres));
    let cle = format!("{}&{}", encoder(consommateur.1), encoder(jeton.map(|j| j.1).unwrap_or("")));
    let mut mac = Hmac::<sha1::Sha1>::new_from_slice(cle.as_bytes()).expect("une clé HMAC accepte toute longueur");
    mac.update(base.as_bytes());
    oauth.insert("oauth_signature".into(), base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes()));
    format!("OAuth {}", oauth.iter().map(|(k, v)| format!("{}=\"{}\"", encoder(k), encoder(v))).collect::<Vec<_>>().join(", "))
}

fn nonce_aleatoire() -> String {
    let mut o = [0u8; 16];
    getrandom::fill(&mut o).expect("aléa du système");
    hex::encode(o)
}

fn maintenant() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn lire_requete(texte: &str) -> BTreeMap<String, String> {
    texte
        .split('&')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_string(), percent_decoder(v)))
        .collect()
}

fn percent_decoder(s: &str) -> String {
    let b = s.as_bytes();
    let mut sortie = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() + 0 && b.len() >= i + 3 => {
                if let Ok(x) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    sortie.push(x);
                    i += 3;
                    continue;
                }
                sortie.push(b'%');
                i += 1;
            }
            b'+' => {
                sortie.push(b' ');
                i += 1;
            }
            c => {
                sortie.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&sortie).into_owned()
}

// ---------- Client ----------

pub struct Client {
    agent: ureq::Agent,
    hotes: Hotes,
    consommateur: Option<(String, String)>,
    jetons: Option<Jetons>,
    /// Jeton d'accès OAuth2 et son échéance (secondes Unix) : gardé en mémoire seulement, renouvelé à partir du jeton OAuth1.
    acces: Option<(String, i64)>,
    methode_mfa: String,
    /// Attente de base avant de redemander après un 429 ou une panne passagère (doublée à chaque essai).
    pub attente: Duration,
}

impl Client {
    pub fn nouveau(hotes: Hotes, jetons: Option<Jetons>) -> Result<Self, ErreurGarmin> {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(30))).build().into();
        Ok(Client { agent, hotes, consommateur: None, jetons, acces: None, methode_mfa: "email".into(), attente: Duration::from_secs(2) })
    }

    pub fn jetons(&self) -> Option<&Jetons> {
        self.jetons.as_ref()
    }

    fn requete(&self, methode: &str, url: &str, entetes: &[(&str, String)], corps: Option<String>) -> Result<(u16, String), ErreurGarmin> {
        let reponse = if methode == "GET" {
            let mut r = self.agent.get(url);
            for (k, v) in entetes {
                r = r.header(*k, v.as_str());
            }
            r.call()
        } else {
            let mut r = self.agent.post(url);
            for (k, v) in entetes {
                r = r.header(*k, v.as_str());
            }
            r.send(corps.unwrap_or_default())
        };
        let mut reponse = reponse.map_err(|e| autre(format!("Garmin est injoignable : {e}")))?;
        let code = reponse.status().as_u16();
        let texte = reponse.body_mut().read_to_string().map_err(|e| autre(format!("réponse de Garmin illisible : {e}")))?;
        Ok((code, texte))
    }

    fn consommateur(&mut self) -> Result<(String, String), ErreurGarmin> {
        if let Some(c) = &self.consommateur {
            return Ok(c.clone());
        }
        let (code, texte) = self.requete("GET", &self.hotes.consommateur.clone(), &[("User-Agent", UA_APP.into())], None)?;
        if code != 200 {
            return Err(autre(format!("clé de l'appli Garmin introuvable (HTTP {code})")));
        }
        let j: Value = serde_json::from_str(&texte).map_err(|_| autre("clé de l'appli Garmin illisible"))?;
        let c = (j["consumer_key"].as_str().ok_or_else(|| autre("clé de l'appli Garmin illisible"))?.to_string(), j["consumer_secret"].as_str().ok_or_else(|| autre("clé de l'appli Garmin illisible"))?.to_string());
        self.consommateur = Some(c.clone());
        Ok(c)
    }

    fn en_tetes_page() -> Vec<(&'static str, String)> {
        vec![("User-Agent", UA_WEB.into()), ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8".into()), ("Accept-Language", "en-US,en;q=0.9".into())]
    }

    fn en_tetes_json(&self) -> Vec<(&'static str, String)> {
        vec![
            ("User-Agent", UA_WEB.into()),
            ("Content-Type", "application/json".into()),
            ("Accept", "application/json, text/plain, */*".into()),
            ("Origin", self.hotes.sso.clone()),
            ("Referer", format!("{}/mobile/sso/en/sign-in?clientId={CLIENT_ID}", self.hotes.sso)),
        ]
    }

    fn requete_connexion(&self) -> String {
        requete_encodee(&[("clientId", CLIENT_ID), ("locale", "en-US"), ("service", SERVICE)])
    }

    fn analyser(&self, code: u16, texte: &str, quoi: &str) -> Result<Value, ErreurGarmin> {
        if code == 429 {
            return Err(autre("Garmin limite les tentatives (429), réessaie plus tard."));
        }
        serde_json::from_str(texte).map_err(|_| autre(format!("Réponse Garmin illisible pendant la {quoi} (HTTP {code}).")))
    }

    /// Ouvre la session avec l'e-mail et le mot de passe (jamais gardés). Rend `CodeRequis` si Garmin demande un code de vérification.
    pub fn connecter(&mut self, email: &str, mot_de_passe: &str) -> Result<Connexion, ErreurGarmin> {
        self.consommateur()?;
        self.requete("GET", &format!("{}/mobile/sso/en/sign-in?clientId={CLIENT_ID}", self.hotes.sso), &Self::en_tetes_page(), None)?;
        let corps = json!({ "username": email, "password": mot_de_passe, "rememberMe": false, "captchaToken": "" }).to_string();
        let (code, texte) = self.requete("POST", &format!("{}/mobile/api/login?{}", self.hotes.sso, self.requete_connexion()), &self.en_tetes_json(), Some(corps))?;
        let j = self.analyser(code, &texte, "connexion")?;
        match j["responseStatus"]["type"].as_str() {
            Some("SUCCESSFUL") => {
                self.finir(j["serviceTicketId"].as_str().ok_or_else(|| autre("Garmin n'a pas donné de ticket de connexion"))?)?;
                Ok(Connexion::Faite)
            }
            Some("MFA_REQUIRED") => {
                self.methode_mfa = j["customerMfaInfo"]["mfaLastMethodUsed"].as_str().filter(|m| !m.is_empty()).unwrap_or("email").to_string();
                Ok(Connexion::CodeRequis(self.methode_mfa.clone()))
            }
            autre_type => Err(auth(format!("Connexion refusée par Garmin ({}). Vérifie l'e-mail et le mot de passe.", autre_type.unwrap_or("?")))),
        }
    }

    pub fn verifier_code(&mut self, code_verification: &str) -> Result<(), ErreurGarmin> {
        let corps = json!({ "mfaMethod": self.methode_mfa, "mfaVerificationCode": code_verification, "rememberMyBrowser": false, "reconsentList": [], "mfaSetup": false }).to_string();
        let (code, texte) = self.requete("POST", &format!("{}/mobile/api/mfa/verifyCode?{}", self.hotes.sso, self.requete_connexion()), &self.en_tetes_json(), Some(corps))?;
        let j = self.analyser(code, &texte, "vérification du code")?;
        if j["responseStatus"]["type"].as_str() != Some("SUCCESSFUL") {
            return Err(auth("Code de vérification refusé."));
        }
        self.finir(j["serviceTicketId"].as_str().ok_or_else(|| autre("Garmin n'a pas donné de ticket de connexion"))?)
    }

    fn finir(&mut self, ticket: &str) -> Result<(), ErreurGarmin> {
        // Pose le cookie de répartition de charge ; un échec ici n'est pas grave.
        let _ = self.requete("GET", &format!("{}/portal/sso/embed", self.hotes.sso), &Self::en_tetes_page(), None);
        let consommateur = self.consommateur()?;
        let url = format!("{}/oauth-service/oauth/preauthorized", self.hotes.api);
        let requete = [("ticket", ticket), ("login-url", SERVICE), ("accepts-mfa-tokens", "true")];
        let en_tete = en_tete_oauth1("GET", &url, &requete, &[], (&consommateur.0, &consommateur.1), None, &nonce_aleatoire(), maintenant());
        let (code, texte) = self.requete("GET", &format!("{url}?{}", requete_encodee(&requete)), &[("User-Agent", UA_APP.into()), ("Authorization", en_tete)], None)?;
        if !(200..300).contains(&code) {
            return Err(auth(format!("Garmin a refusé le ticket de connexion (HTTP {code}).")));
        }
        let t = lire_requete(&texte);
        self.jetons = Some(Jetons {
            oauth1_token: t.get("oauth_token").cloned().ok_or_else(|| autre("Réponse Garmin inattendue."))?,
            oauth1_secret: t.get("oauth_token_secret").cloned().ok_or_else(|| autre("Réponse Garmin inattendue."))?,
        });
        self.rafraichir(true)
    }

    fn rafraichir(&mut self, avec_audience: bool) -> Result<(), ErreurGarmin> {
        let jetons = self.jetons.clone().ok_or_else(|| auth("Pas connecté à Garmin."))?;
        let consommateur = self.consommateur()?;
        let formulaire: Vec<(&str, &str)> = if avec_audience { vec![("audience", AUDIENCE)] } else { vec![] };
        let url = format!("{}/oauth-service/oauth/exchange/user/2.0", self.hotes.api);
        let en_tete = en_tete_oauth1("POST", &url, &[], &formulaire, (&consommateur.0, &consommateur.1), Some((&jetons.oauth1_token, &jetons.oauth1_secret)), &nonce_aleatoire(), maintenant());
        let (code, texte) = self.requete(
            "POST",
            &url,
            &[("User-Agent", UA_APP.into()), ("Content-Type", "application/x-www-form-urlencoded".into()), ("Authorization", en_tete)],
            Some(requete_encodee(&formulaire)),
        )?;
        if !(200..300).contains(&code) {
            return Err(auth(format!("Garmin a refusé le renouvellement de session (HTTP {code}).")));
        }
        let j: Value = serde_json::from_str(&texte).map_err(|_| autre("réponse de renouvellement illisible"))?;
        let jeton = j["access_token"].as_str().ok_or_else(|| autre("réponse de renouvellement inattendue"))?.to_string();
        self.acces = Some((jeton, maintenant() + j["expires_in"].as_i64().unwrap_or(3600)));
        Ok(())
    }

    fn api_get(&self, chemin: &str) -> Result<(u16, String), ErreurGarmin> {
        let jeton = self.acces.as_ref().map(|a| a.0.clone()).unwrap_or_default();
        self.requete("GET", &format!("{}{chemin}", self.hotes.api), &[("Authorization", format!("Bearer {jeton}")), ("User-Agent", UA_APP.into())], None)
    }

    /// Un service de l'API (« /activitylist-service/… »). Renouvelle le jeton d'accès quand il va expirer, et redemande quelques fois après un 429 ou une
    /// panne passagère. Rend `Null` pour une réponse vide (204, par exemple la VFC d'un jour sans donnée).
    pub fn get(&mut self, chemin: &str) -> Result<Value, ErreurGarmin> {
        if self.jetons.is_none() {
            return Err(auth("Pas connecté à Garmin."));
        }
        if self.acces.as_ref().map_or(true, |a| a.1 - 60 < maintenant()) {
            self.rafraichir(false)?;
        }
        let mut reponse = self.api_get(chemin)?;
        if reponse.0 == 401 {
            self.rafraichir(false)?;
            reponse = self.api_get(chemin)?;
        }
        let mut essai = 0;
        while (reponse.0 == 429 || (500..600).contains(&reponse.0)) && essai < 3 {
            std::thread::sleep(self.attente * (1 << essai));
            essai += 1;
            reponse = self.api_get(chemin)?;
        }
        match reponse.0 {
            401 | 403 => Err(auth("Session Garmin expirée, reconnecte-toi.")),
            204 => Ok(Value::Null),
            200..=299 => serde_json::from_str(&reponse.1).map_err(|_| autre(format!("réponse de Garmin illisible sur {chemin}"))),
            c => Err(autre(format!("Garmin HTTP {c} sur {chemin}"))),
        }
    }
}

/// Faux Garmin pour les tests : un serveur HTTP local qui imite le SSO mobile, l'échange de jetons OAuth et l'API. Il EXIGE ce que le vrai exige (cookie posé par
/// la page de connexion, en-tête OAuth signé, jeton Bearer du dernier échange) : un client qui l'oublierait échouerait ici comme chez Garmin.
#[cfg(test)]
pub(crate) mod faux {
    /// Faux jetons du faux serveur Garmin : lus dans l'environnement (voir `desktop/.env.example`), jamais écrits en clair dans le code.
    pub(crate) fn jeton_test() -> String {
        std::env::var("FOULEE_TEST_JETON").unwrap_or_else(|_| "jeton+essai".into())
    }
    pub(crate) fn secret_test() -> String {
        std::env::var("FOULEE_TEST_SECRET").unwrap_or_else(|_| "secret/essai".into())
    }

    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Clone, Copy, PartialEq)]
    pub enum Mode {
        Normal,
        /// Le premier appel d'API répond 401 (jeton d'accès expiré) : le client doit renouveler puis réessayer.
        PremierAppel401,
        /// Les deux premiers appels d'API répondent 429.
        Limite429Deux,
        /// Le jeton OAuth1 est révoqué : l'échange est refusé.
        Revoque,
    }

    #[derive(Default)]
    pub struct Compteurs {
        pub echanges: AtomicUsize,
        pub api: AtomicUsize,
    }

    fn corps_json(v: Value) -> (u16, String) {
        (200, v.to_string())
    }

    fn api(chemin: &str, requete: &str) -> (u16, String) {
        let param = |n: &str| requete.split('&').find_map(|p| p.strip_prefix(&format!("{n}="))).unwrap_or("").to_string();
        let activites = [
            ("2026-11-12 16:52:03", "running", 16191.0, 101), ("2026-11-11 11:44:10", "running", 4216.0, 102), ("2026-11-10 07:00:00", "cycling", 30000.0, 103),
            ("2026-11-09 17:45:00", "running", 16375.0, 104), ("2026-11-08 10:21:00", "running", 500.0, 105),
        ];
        if chemin == "/userprofile-service/socialProfile" {
            return corps_json(json!({ "displayName": "abc-123", "fullName": "Camille Dupont" }));
        }
        if chemin == "/activitylist-service/activities/count" {
            return corps_json(json!({ "totalCount": 5 }));
        }
        if chemin == "/activitylist-service/activities/search/activities" {
            let (debut, limite): (usize, usize) = (param("start").parse().unwrap_or(0), param("limit").parse().unwrap_or(20));
            let items: Vec<Value> = activites.iter().skip(debut).take(limite).map(|(d, t, k, id)| json!({ "activityId": id, "activityName": format!("Sortie {id}"), "startTimeLocal": d, "activityType": { "typeKey": t }, "distance": k, "duration": 3000.0, "averageSpeed": 3.3, "averageHR": 150.0, "maxHR": 171.0, "activityTrainingLoad": 80.0, "elevationGain": 12.0 })).collect();
            return corps_json(Value::Array(items));
        }
        if let Some(id) = chemin.strip_prefix("/activity-service/activity/").and_then(|r| r.strip_suffix("/splits")) {
            if id == "105" {
                return (500, String::new());
            }
            return corps_json(json!({ "activityId": id, "lapDTOs": [ { "distance": 1000.0, "duration": 300.0, "averageSpeed": 3.3, "averageHR": 150.0, "maxHR": 160.0, "elevationGain": 2.0, "intensityType": "ACTIVE", "wktStepIndex": 1 }, { "distance": 200.0, "duration": 90.0, "intensityType": "RECOVERY" } ] }));
        }
        if chemin.starts_with("/usersummary-service/usersummary/daily/abc-123") {
            return corps_json(json!({ "restingHeartRate": 41, "averageStressLevel": -1, "bodyBatteryHighestValue": 90, "totalSteps": 9000 }));
        }
        if chemin == "/sleep-service/sleep/dailySleepData" {
            return corps_json(json!({ "dailySleepDTO": { "sleepTimeSeconds": 27000, "sleepScores": { "overall": { "value": 82 } } }, "avgOvernightHrv": 61.0 }));
        }
        if chemin.starts_with("/hrv-service/hrv/") {
            return (204, String::new());
        }
        (404, String::new())
    }

    fn repondre(mode: Mode, compteurs: &Compteurs, methode: &str, chemin: &str, requete: &str, entetes: &std::collections::HashMap<String, String>, corps: &str) -> (u16, String, Vec<(&'static str, &'static str)>) {
        let sans = |(c, t): (u16, String)| (c, t, vec![]);
        let auth_oauth = entetes.get("authorization").cloned().unwrap_or_default();
        match (methode, chemin) {
            ("GET", "/oauth_consumer.json") => sans(corps_json(json!({ "consumer_key": "ck", "consumer_secret": "cs" }))),
            ("GET", "/mobile/sso/en/sign-in") => (200, "<html>connexion</html>".into(), vec![("Set-Cookie", "GARMIN-SSO=abc; Path=/")]),
            ("POST", "/mobile/api/login") => {
                if !entetes.get("cookie").is_some_and(|c| c.contains("GARMIN-SSO=abc")) {
                    return sans((400, json!({ "erreur": "cookie de session absent" }).to_string()));
                }
                let j: Value = serde_json::from_str(corps).unwrap_or(Value::Null);
                match j["password"].as_str() {
                    Some("mfa") => sans(corps_json(json!({ "responseStatus": { "type": "MFA_REQUIRED" }, "customerMfaInfo": { "mfaLastMethodUsed": "email" } }))),
                    Some("mauvais") => sans(corps_json(json!({ "responseStatus": { "type": "INVALID_USERNAME_PASSWORD" } }))),
                    Some("limite") => sans((429, String::new())),
                    _ if j["username"] == "eloi@example.com" => sans(corps_json(json!({ "responseStatus": { "type": "SUCCESSFUL" }, "serviceTicketId": "ST-1" }))),
                    _ => sans(corps_json(json!({ "responseStatus": { "type": "INVALID_USERNAME_PASSWORD" } }))),
                }
            }
            ("POST", "/mobile/api/mfa/verifyCode") => {
                let j: Value = serde_json::from_str(corps).unwrap_or(Value::Null);
                if j["mfaVerificationCode"] == "123456" && j["mfaMethod"] == "email" {
                    sans(corps_json(json!({ "responseStatus": { "type": "SUCCESSFUL" }, "serviceTicketId": "ST-1" })))
                } else {
                    sans(corps_json(json!({ "responseStatus": { "type": "INVALID_CODE" } })))
                }
            }
            ("GET", "/portal/sso/embed") => sans((200, String::new())),
            ("GET", "/oauth-service/oauth/preauthorized") => {
                if requete.contains("ticket=ST-1") && auth_oauth.starts_with("OAuth ") && auth_oauth.contains("oauth_consumer_key=\"ck\"") && auth_oauth.contains("oauth_signature=") {
                    sans((200, format!("oauth_token={}&oauth_token_secret={}&mfa_token=x", encoder(&jeton_test()), encoder(&secret_test()))))
                } else {
                    sans((401, String::new()))
                }
            }
            ("POST", "/oauth-service/oauth/exchange/user/2.0") => {
                if mode == Mode::Revoque || !auth_oauth.contains(&format!("oauth_token=\"{}\"", encoder(&jeton_test()))) || !auth_oauth.contains("oauth_signature=") {
                    return sans((401, String::new()));
                }
                let n = compteurs.echanges.fetch_add(1, Ordering::SeqCst) + 1;
                sans(corps_json(json!({ "access_token": format!("acces-{n}"), "expires_in": 3600 })))
            }
            ("GET", c) => {
                let n = compteurs.api.fetch_add(1, Ordering::SeqCst);
                let attendu = format!("Bearer acces-{}", compteurs.echanges.load(Ordering::SeqCst));
                if (mode == Mode::PremierAppel401 && n == 0) || entetes.get("authorization").map(String::as_str) != Some(attendu.as_str()) {
                    return sans((401, String::new()));
                }
                if mode == Mode::Limite429Deux && n < 2 {
                    return sans((429, String::new()));
                }
                sans(api(c, requete))
            }
            _ => sans((404, String::new())),
        }
    }

    pub fn lancer(mode: Mode) -> (Hotes, Arc<Compteurs>) {
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let origine = format!("http://127.0.0.1:{}", ecoute.local_addr().unwrap().port());
        let compteurs = Arc::new(Compteurs::default());
        let c = compteurs.clone();
        std::thread::spawn(move || {
            for flux in ecoute.incoming() {
                let Ok(mut flux) = flux else { continue };
                let c = c.clone();
                std::thread::spawn(move || {
                    let mut tampon = Vec::new();
                    let mut bloc = [0u8; 4096];
                    let fin_entetes = loop {
                        let n = flux.read(&mut bloc).unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        tampon.extend_from_slice(&bloc[..n]);
                        if let Some(i) = tampon.windows(4).position(|w| w == b"\r\n\r\n") {
                            break i;
                        }
                    };
                    let tete = String::from_utf8_lossy(&tampon[..fin_entetes]).to_string();
                    let mut lignes = tete.lines();
                    let mut premiere = lignes.next().unwrap_or("").split_whitespace();
                    let (methode, cible) = (premiere.next().unwrap_or("").to_string(), premiere.next().unwrap_or("/").to_string());
                    let entetes: std::collections::HashMap<String, String> = lignes.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
                    let longueur: usize = entetes.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
                    while tampon.len() < fin_entetes + 4 + longueur {
                        let n = flux.read(&mut bloc).unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        tampon.extend_from_slice(&bloc[..n]);
                    }
                    let corps = String::from_utf8_lossy(&tampon[(fin_entetes + 4).min(tampon.len())..]).to_string();
                    let (chemin, requete) = cible.split_once('?').unwrap_or((cible.as_str(), ""));
                    let (code, texte, supplementaires) = repondre(mode, &c, &methode, chemin, requete, &entetes, &corps);
                    let mut reponse = format!("HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n", texte.len());
                    for (k, v) in supplementaires {
                        reponse.push_str(&format!("{k}: {v}\r\n"));
                    }
                    reponse.push_str("\r\n");
                    let _ = flux.write_all(reponse.as_bytes());
                    let _ = flux.write_all(texte.as_bytes());
                });
            }
        });
        (Hotes { sso: origine.clone(), api: origine.clone(), consommateur: format!("{origine}/oauth_consumer.json") }, compteurs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exemple de la norme OAuth Core 1.0, annexe A.5.1 : la signature doit être exactement celle publiée.
    #[test]
    fn la_signature_oauth1_est_celle_de_la_norme() {
        let en_tete = en_tete_oauth1(
            "GET",
            "http://photos.example.net/photos",
            &[("file", "vacation.jpg"), ("size", "original")],
            &[],
            ("dpf43f3p2l4k3l03", "kd94hf93k423kf44"),
            Some(("nnch734d00sl2jdk", "pfkkdhi9sl3r4s00")),
            "kllo9940pd9333jh",
            1191242096,
        );
        assert!(en_tete.starts_with("OAuth "));
        assert!(en_tete.contains("oauth_signature=\"tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D\""), "{en_tete}");
        assert!(en_tete.contains("oauth_consumer_key=\"dpf43f3p2l4k3l03\"") && en_tete.contains("oauth_token=\"nnch734d00sl2jdk\""));
    }

    #[test]
    fn l_encodage_est_celui_d_oauth() {
        assert_eq!(encoder("aZ09-._~"), "aZ09-._~");
        assert_eq!(encoder("a b+c/d=e&é"), "a%20b%2Bc%2Fd%3De%26%C3%A9");
        assert_eq!(percent_decoder("a%20b%2Bc+d"), "a b+c d");
        assert_eq!(percent_decoder("100%"), "100%", "un pour-cent isolé reste tel quel");
        assert_eq!(lire_requete(&format!("oauth_token={}&oauth_token_secret=d%2Fe&vide", "x")).get("oauth_token_secret").map(String::as_str), Some("d/e"));
    }

    use super::faux::{lancer, Mode};
    use std::sync::atomic::Ordering;

    fn client(mode: Mode) -> (Client, std::sync::Arc<faux::Compteurs>) {
        let (hotes, compteurs) = lancer(mode);
        let mut c = Client::nouveau(hotes, None).unwrap();
        c.attente = Duration::from_millis(1);
        (c, compteurs)
    }

    #[test]
    fn la_connexion_garde_les_cookies_signe_les_requetes_et_range_le_jeton_oauth1() {
        let (mut c, compteurs) = client(Mode::Normal);
        assert_eq!(c.connecter("eloi@example.com", "secret").unwrap(), Connexion::Faite);
        // Le jeton OAuth1 est celui du faux serveur, décodé (décodé) ; le mot de passe n'est nulle part dans le client.
        assert_eq!(c.jetons(), Some(&Jetons { oauth1_token: faux::jeton_test(), oauth1_secret: faux::secret_test() }));
        assert_eq!(compteurs.echanges.load(Ordering::SeqCst), 1, "un échange OAuth2 à la connexion");
        assert_eq!(c.get("/userprofile-service/socialProfile").unwrap()["displayName"], "abc-123");
        assert_eq!(compteurs.echanges.load(Ordering::SeqCst), 1, "le jeton d'accès encore valable n'est pas renouvelé");
    }

    #[test]
    fn un_mauvais_mot_de_passe_ou_trop_d_essais_donnent_un_message_clair() {
        let (mut c, _) = client(Mode::Normal);
        let e = c.connecter("eloi@example.com", "mauvais").unwrap_err();
        assert!(matches!(&e, ErreurGarmin::Auth(m) if m.contains("Vérifie l'e-mail et le mot de passe")), "{e}");
        let e = c.connecter("eloi@example.com", "limite").unwrap_err();
        assert!(matches!(&e, ErreurGarmin::Autre(m) if m.contains("429")), "{e}");
        assert!(c.jetons().is_none());
    }

    #[test]
    fn le_code_de_verification_est_demande_puis_verifie() {
        let (mut c, _) = client(Mode::Normal);
        assert_eq!(c.connecter("eloi@example.com", "mfa").unwrap(), Connexion::CodeRequis("email".into()));
        assert!(c.jetons().is_none(), "pas de jeton tant que le code n'est pas bon");
        let e = c.verifier_code("000000").unwrap_err();
        assert!(matches!(&e, ErreurGarmin::Auth(m) if m.contains("Code de vérification refusé")), "{e}");
        c.verifier_code("123456").unwrap();
        assert!(c.jetons().is_some());
        assert!(c.get("/userprofile-service/socialProfile").is_ok());
    }

    #[test]
    fn un_jeton_expire_est_renouvele_et_un_429_est_redemande() {
        let (mut c, compteurs) = client(Mode::PremierAppel401);
        c.connecter("eloi@example.com", "secret").unwrap();
        assert!(c.get("/userprofile-service/socialProfile").is_ok(), "401 : renouvelle puis réessaie");
        assert_eq!(compteurs.echanges.load(Ordering::SeqCst), 2);
        let (mut c2, _) = client(Mode::Limite429Deux);
        c2.connecter("eloi@example.com", "secret").unwrap();
        assert!(c2.get("/userprofile-service/socialProfile").is_ok(), "429 deux fois, puis la réponse");
    }

    #[test]
    fn une_session_revoquee_ou_absente_demande_de_se_reconnecter() {
        let (mut c, _) = client(Mode::Normal);
        assert!(matches!(c.get("/userprofile-service/socialProfile"), Err(ErreurGarmin::Auth(m)) if m.contains("Pas connecté")));
        let (hotes, _) = lancer(Mode::Revoque);
        let mut revoque = Client::nouveau(hotes, Some(Jetons { oauth1_token: faux::jeton_test(), oauth1_secret: faux::secret_test() })).unwrap();
        let e = revoque.get("/userprofile-service/socialProfile").unwrap_err();
        assert!(matches!(&e, ErreurGarmin::Auth(m) if m.contains("renouvellement")), "{e}");
    }
}

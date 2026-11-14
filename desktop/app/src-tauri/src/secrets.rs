//! Secrets dans le trousseau de l'OS (Credential Manager, Keychain, Secret Service).
//! Jamais dans la base, jamais dans un fichier.

use keyring::Entry;

const SERVICE: &str = "fr.foulee.desktop";

/// Clé de chiffrement de la base : créée au premier lancement (32 octets aléatoires), relue ensuite.
pub fn cle_base() -> Result<String, String> {
    let entree = Entry::new(SERVICE, "cle-base").map_err(|e| format!("trousseau indisponible : {e}"))?;
    match entree.get_password() {
        Ok(cle) => Ok(cle),
        Err(keyring::Error::NoEntry) => {
            let mut octets = [0u8; 32];
            getrandom::fill(&mut octets).map_err(|e| format!("aléa indisponible : {e}"))?;
            let cle = hex::encode(octets);
            entree.set_password(&cle).map_err(|e| format!("écriture dans le trousseau : {e}"))?;
            Ok(cle)
        }
        Err(e) => Err(format!("lecture du trousseau : {e}")),
    }
}

/// Relit la clé de la base SANS en créer une : pour le serveur MCP, qui ne doit jamais fabriquer une clé ni une base vide.
pub fn cle_existante() -> Result<String, String> {
    let entree = Entry::new(SERVICE, "cle-base").map_err(|e| format!("trousseau indisponible : {e}"))?;
    match entree.get_password() {
        Ok(cle) => Ok(cle),
        Err(keyring::Error::NoEntry) => Err("aucune clé de base : ouvre Foulée une première fois".into()),
        Err(e) => Err(format!("lecture du trousseau : {e}")),
    }
}

/// Les seuls secrets que l'interface peut écrire. Il n'existe volontairement aucune commande pour les relire :
/// le webview ne voit jamais une valeur, seul le code Rust (futurs clients Garmin et Nolio) les lit.
pub const NOMS: &[&str] = &["garmin-email", "garmin-motdepasse", "nolio-cle", "garmin-oauth1-token", "garmin-oauth1-secret"];

fn valider(nom: &str) -> Result<(), String> {
    if NOMS.contains(&nom) { Ok(()) } else { Err(format!("secret inconnu : {nom}")) }
}

fn valider_valeur(valeur: &str) -> Result<(), String> {
    if valeur.trim().is_empty() {
        return Err("valeur vide".into());
    }
    if valeur.len() > 512 || valeur.chars().any(|c| c.is_control()) {
        return Err("valeur invalide".into());
    }
    Ok(())
}

fn entree(nom: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, nom).map_err(|e| format!("trousseau indisponible : {e}"))
}

pub fn definir(nom: &str, valeur: &str) -> Result<(), String> {
    valider(nom)?;
    valider_valeur(valeur)?;
    entree(nom)?.set_password(valeur.trim()).map_err(|e| format!("écriture dans le trousseau : {e}"))
}

pub fn existe(nom: &str) -> Result<bool, String> {
    valider(nom)?;
    match entree(nom)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("lecture du trousseau : {e}")),
    }
}

pub fn supprimer(nom: &str) -> Result<(), String> {
    valider(nom)?;
    match entree(nom)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("suppression dans le trousseau : {e}")),
    }
}

/// Lecture réservée au code Rust (clients des sources). Jamais exposée au webview.
#[allow(dead_code)]
pub fn lire(nom: &str) -> Result<Option<String>, String> {
    valider(nom)?;
    match entree(nom)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("lecture du trousseau : {e}")),
    }
}

/// Lignes « CLE=valeur » d'un fichier .env : commentaires et lignes vides ignorés, guillemets simples ou doubles retirés.
pub fn parser_env(contenu: &str) -> Vec<(String, String)> {
    contenu
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|x| x.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|x| x.strip_suffix('\''))).unwrap_or(v);
            Some((k.trim().to_string(), v.to_string()))
        })
        .collect()
}

/// Correspondance variable d'environnement -> nom de secret.
const ENV_VERS_SECRET: &[(&str, &str)] = &[
    ("FOULEE_GARMIN_EMAIL", "garmin-email"),
    ("FOULEE_GARMIN_PASSWORD", "garmin-motdepasse"),
    ("FOULEE_NOLIO_API_KEY", "nolio-cle"),
];

/// Valeurs à ranger depuis un .env : seulement celles qui sont renseignées (pas « change-me ») et connues.
pub fn secrets_du_env(contenu: &str) -> Vec<(&'static str, String)> {
    let lignes = parser_env(contenu);
    ENV_VERS_SECRET
        .iter()
        .filter_map(|(var, nom)| {
            let v = lignes.iter().find(|(k, _)| k == var)?.1.clone();
            (!v.is_empty() && v != "change-me" && valider_valeur(&v).is_ok()).then_some((*nom, v))
        })
        .collect()
}

/// Build de développement seulement : range dans le trousseau les valeurs de `desktop/.env` qui n'y sont pas encore.
/// Ne remplace jamais une valeur existante, n'écrit aucune valeur dans un journal. Un build de production ne lit aucun .env.
#[cfg(debug_assertions)]
pub fn amorcer_depuis_env() {
    let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join(".env");
    let Ok(contenu) = std::fs::read_to_string(&chemin) else { return };
    for (nom, valeur) in secrets_du_env(&contenu) {
        if matches!(existe(nom), Ok(false)) && definir(nom, &valeur).is_ok() {
            eprintln!("[dev] secret « {nom} » rangé dans le trousseau depuis desktop/.env");
        }
    }
}

#[cfg(not(debug_assertions))]
pub fn amorcer_depuis_env() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_parseur_ignore_commentaires_et_enleve_les_guillemets() {
        let v = parser_env("# commentaire\n\nA=1\nB = \"deux mots\"\nC='x'\nsans_egal\n");
        assert_eq!(v, vec![("A".into(), "1".into()), ("B".into(), "deux mots".into()), ("C".into(), "x".into())]);
    }

    #[test]
    fn seules_les_valeurs_renseignees_sont_reprises() {
        let env = "FOULEE_GARMIN_EMAIL=moi@exemple.fr\nFOULEE_GARMIN_PASSWORD=change-me\nFOULEE_NOLIO_API_KEY=\nAUTRE=1\n";
        let r = secrets_du_env(env);
        assert_eq!(r, vec![("garmin-email", "moi@exemple.fr".to_string())]);
    }

    #[test]
    fn seuls_les_noms_connus_et_les_valeurs_saines_sont_acceptes() {
        assert!(valider("nolio-cle").is_ok());
        assert!(valider("cle-base").is_err(), "la clé de la base ne doit jamais être modifiable depuis l'interface");
        assert!(valider("n'importe-quoi").is_err());
        assert!(valider_valeur("").is_err());
        assert!(valider_valeur("   ").is_err());
        assert!(valider_valeur("a\nb").is_err());
        assert!(valider_valeur(&"x".repeat(513)).is_err());
        assert!(valider_valeur("un mot de passe correct").is_ok());
    }
}

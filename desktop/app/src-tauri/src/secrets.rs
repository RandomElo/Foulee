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

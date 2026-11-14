//! Mise à jour de l'appli, à la façon de Notes : une nouvelle version remplace le fichier installé (l'AppImage sous Linux), l'appli
//! en cours le voit et propose « Mettre à jour » ; un clic la relance sur le nouveau fichier. Pas de serveur de mise à jour, pas de
//! téléchargement : seul ce qui est déjà posé sur la machine par l'installeur est relancé.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// Pause avant d'ouvrir la base au lancement d'une instance relancée : l'ancienne a le temps de se fermer.
pub const VARIABLE_ATTENTE: &str = "FOULEE_RELANCE_APRES_MS";

/// Le fichier qui contient l'appli : l'AppImage sous Linux (le binaire en cours vit dans un montage temporaire qui ne change pas),
/// sinon l'exécutable en cours.
pub fn chemin_installe() -> Option<PathBuf> {
    if let Some(a) = std::env::var_os("APPIMAGE").filter(|a| !a.is_empty()) {
        return Some(PathBuf::from(a));
    }
    std::env::current_exe().ok()
}

#[derive(Debug, Clone, PartialEq)]
struct Empreinte {
    inode: u64,
    longueur: u64,
    modifie: Option<SystemTime>,
}

fn empreinte(p: &Path) -> Option<Empreinte> {
    let m = std::fs::metadata(p).ok()?;
    #[cfg(unix)]
    let inode = std::os::unix::fs::MetadataExt::ino(&m);
    #[cfg(not(unix))]
    let inode = 0;
    Some(Empreinte { inode, longueur: m.len(), modifie: m.modified().ok() })
}

fn executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.exists()
    }
}

/// La règle de décision d'un passage : le fichier a changé depuis le départ, il n'a plus bougé depuis le passage précédent (une copie en cours
/// change à chaque passage) et il est exécutable. Séparée du fil de surveillance pour être testée sans dépendre de l'horloge.
fn doit_alerter(depart: &Empreinte, precedent: Option<&Empreinte>, courant: &Empreinte, executable: impl FnOnce() -> bool) -> bool {
    courant != depart && precedent == Some(courant) && executable()
}

/// Surveille `chemin` et appelle `rappel` une fois quand le fichier est remplacé par une autre version. Il faut que le fichier ait cessé
/// de changer d'un passage au suivant (une copie en cours n'est pas une installation) et qu'il soit exécutable. S'arrête avec `arret`.
pub fn surveiller(chemin: PathBuf, intervalle: Duration, arret: Arc<AtomicBool>, rappel: impl FnOnce() + Send + 'static) {
    std::thread::spawn(move || {
        let Some(depart) = empreinte(&chemin) else { return };
        let mut precedent: Option<Empreinte> = None;
        loop {
            std::thread::sleep(intervalle);
            if arret.load(Ordering::SeqCst) {
                return;
            }
            let Some(courant) = empreinte(&chemin) else {
                precedent = None;
                continue;
            };
            if doit_alerter(&depart, precedent.as_ref(), &courant, || executable(&chemin)) {
                rappel();
                return;
            }
            precedent = Some(courant);
        }
    });
}

/// Pause demandée par l'instance qui nous a relancés (bornée : une valeur absurde ne bloque pas le démarrage).
pub fn attente_au_lancement() -> Duration {
    lire_attente(std::env::var(VARIABLE_ATTENTE).ok().as_deref())
}

fn lire_attente(valeur: Option<&str>) -> Duration {
    Duration::from_millis(valeur.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0).min(10_000))
}

/// Lance une nouvelle instance sur le fichier installé. L'appelant quitte ensuite.
pub fn lancer_nouvelle_instance(chemin: &Path) -> Result<(), String> {
    std::process::Command::new(chemin)
        .env(VARIABLE_ATTENTE, "1500")
        // Variables de l'ancien montage AppImage : la nouvelle AppImage pose les siennes.
        .env_remove("APPDIR")
        .env_remove("ARGV0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("relance impossible : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicUsize;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("foulee-maj-{}-{nom}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[cfg(unix)]
    fn rendre_executable(p: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(p, fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(not(unix))]
    fn rendre_executable(_: &Path) {}

    fn attendre(compteur: &AtomicUsize, valeur: usize, ms: u64) -> bool {
        let debut = std::time::Instant::now();
        while debut.elapsed() < Duration::from_millis(ms) {
            if compteur.load(Ordering::SeqCst) >= valeur {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn lancer_surveillance(chemin: &Path) -> (Arc<AtomicUsize>, Arc<AtomicBool>) {
        lancer_surveillance_toutes_les(chemin, 40)
    }

    fn lancer_surveillance_toutes_les(chemin: &Path, ms: u64) -> (Arc<AtomicUsize>, Arc<AtomicBool>) {
        let compteur = Arc::new(AtomicUsize::new(0));
        let arret = Arc::new(AtomicBool::new(false));
        let c = compteur.clone();
        surveiller(chemin.to_path_buf(), Duration::from_millis(ms), arret.clone(), move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        (compteur, arret)
    }

    #[test]
    fn un_fichier_remplace_par_une_autre_version_est_signale_une_seule_fois() {
        let d = dossier("remplace");
        let appli = d.join("Foulee.AppImage");
        fs::write(&appli, b"version 1").unwrap();
        rendre_executable(&appli);
        let (compteur, arret) = lancer_surveillance(&appli);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(compteur.load(Ordering::SeqCst), 0, "rien n'a changé : pas de mise à jour");

        // Comme l'installeur : on écrit à côté puis on renomme par-dessus.
        let neuf = d.join("Foulee.AppImage.neuf");
        fs::write(&neuf, b"version 2, plus longue").unwrap();
        rendre_executable(&neuf);
        fs::rename(&neuf, &appli).unwrap();
        assert!(attendre(&compteur, 1, 10_000), "le remplacement n'a pas été vu");
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(compteur.load(Ordering::SeqCst), 1, "une seule alerte par mise à jour");
        arret.store(true, Ordering::SeqCst);
        let _ = fs::remove_dir_all(&d);
    }

    fn emp(longueur: u64) -> Empreinte {
        Empreinte { inode: 1, longueur, modifie: None }
    }

    #[test]
    fn une_copie_en_cours_n_est_pas_prise_pour_une_installation() {
        let depart = emp(9);
        // Le fichier grossit à chaque passage : jamais stable, donc jamais signalé, quel que soit le nombre de passages.
        let mut precedent: Option<Empreinte> = None;
        for taille in [100, 150, 200, 250, 300] {
            let courant = emp(taille);
            assert!(!doit_alerter(&depart, precedent.as_ref(), &courant, || true), "copie encore en cours à {taille}");
            precedent = Some(courant);
        }
        // Une fois la copie finie, deux passages identiques de suite : c'est signalé.
        let fini = emp(300);
        assert!(doit_alerter(&depart, precedent.as_ref(), &fini, || true));
        // Mais pas si le fichier est revenu à l'état de départ, ni s'il n'est pas exécutable, ni au premier passage.
        assert!(!doit_alerter(&depart, Some(&depart), &depart, || true));
        assert!(!doit_alerter(&depart, precedent.as_ref(), &fini, || false));
        assert!(!doit_alerter(&depart, None, &fini, || true));
    }

    #[cfg(unix)]
    #[test]
    fn un_fichier_non_executable_n_est_pas_une_mise_a_jour() {
        use std::os::unix::fs::PermissionsExt;
        let d = dossier("non-exec");
        let appli = d.join("Foulee.AppImage");
        fs::write(&appli, b"version 1").unwrap();
        rendre_executable(&appli);
        let (compteur, arret) = lancer_surveillance(&appli);
        let neuf = d.join("neuf");
        fs::write(&neuf, b"autre chose").unwrap();
        fs::set_permissions(&neuf, fs::Permissions::from_mode(0o644)).unwrap();
        fs::rename(&neuf, &appli).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(compteur.load(Ordering::SeqCst), 0);
        arret.store(true, Ordering::SeqCst);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn l_arret_demande_coupe_la_surveillance_et_un_fichier_absent_ne_plante_pas() {
        let d = dossier("arret");
        let appli = d.join("Foulee.AppImage");
        fs::write(&appli, b"v1").unwrap();
        rendre_executable(&appli);
        let (compteur, arret) = lancer_surveillance(&appli);
        arret.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(150));
        fs::write(&appli, b"v2 plus long").unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(compteur.load(Ordering::SeqCst), 0);
        // Fichier absent au départ : la surveillance se termine sans rien faire.
        let (c2, _) = lancer_surveillance(&d.join("absent"));
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(c2.load(Ordering::SeqCst), 0);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn l_attente_au_lancement_est_bornee() {
        assert_eq!(lire_attente(Some("1500")), Duration::from_millis(1500));
        assert_eq!(lire_attente(Some("999999999")), Duration::from_millis(10_000));
        assert_eq!(lire_attente(Some("abc")), Duration::ZERO);
        assert_eq!(lire_attente(Some("-5")), Duration::ZERO);
        assert_eq!(lire_attente(None), Duration::ZERO);
    }

    #[cfg(unix)]
    #[test]
    fn la_relance_demarre_le_fichier_installe_avec_l_attente() {
        use std::io::Write;
        let d = dossier("relance");
        let marque = d.join("lance.txt");
        let script = d.join("Foulee.AppImage");
        let mut f = fs::File::create(&script).unwrap();
        writeln!(f, "#!/bin/sh\necho \"$FOULEE_RELANCE_APRES_MS\" > \"{}\"", marque.display()).unwrap();
        drop(f);
        rendre_executable(&script);
        lancer_nouvelle_instance(&script).unwrap();
        let debut = std::time::Instant::now();
        while !marque.exists() && debut.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(30));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(fs::read_to_string(&marque).unwrap().trim(), "1500");
        assert!(lancer_nouvelle_instance(&d.join("n-existe-pas")).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}

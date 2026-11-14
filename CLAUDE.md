# Foulée : règles de travail

## Chaque remarque d'Eloi est un symptôme, pas un ticket

Avant de corriger le cas cité :
1. Nommer la classe de problèmes dont il fait partie (pas seulement « cette séance », « cet écran »).
2. Chercher les autres endroits du code ou les autres séances concernés, et lister les cas limites voisins.
3. Corriger la classe, puis dire dans la réponse ce qui a été vérifié au-delà du cas cité et ce qui ne l'a pas été.

Exemples : accueil pas à jour = toute donnée affichée sans règle de rafraîchissement ; étape de synchro bloquée = tout appel réseau sans état visible, sans délai maximum, sans sortie.

## Détection des séances (Intervals.kt, SessionAnalysis.kt, StravaText.kt)

Aucun changement de détection sans filet :
0. Banc de test hors téléphone : `~/demo-claude/foulee/detection/` (`build.sh` compile directement `Intervals.kt` du projet, `run.sh <laps.tsv>` rejoue toutes les vraies séances, `run.sh synth` joue les séances synthétiques tirées de ses plans). Les laps réels viennent de la base copiée (table `activity_details`, colonne `laps`). Ajouter un cas dans `src/Synth.kt` pour chaque nouvelle structure de séance.
1. Copier la base (`adb exec-out run-as fr.foulee.app cat databases/foulee.db`) dans le scratchpad et sortir les titres de toutes les séances avant et après la modification. Comparer : seuls les titres voulus changent.
2. Avant de coder, lister les structures possibles et vérifier chacune : fractionné simple, pyramide, blocs « n × (a + b + c) », séries avec récupération inter-séries, temps ou distance, tempo, côtes, footing avec lignes droites, séance sans lap manuel, laps de la montre qui ne correspondent pas à la séance prévue (efforts 300 m au lieu de 200 m, récupération qui inclut marche et repos), démarrage tardif, séance coupée.
3. Chaque séance qui a déjà posé problème devient un cas de contrôle (4 nov, 6 nov, 2024-06-11, 2024-11-12, etc.) : son titre attendu doit rester identique.
4. Ne pas tester par essais successifs sur le téléphone d'Eloi, ne pas relancer l'appli en boucle.
5. Les commentaires de séance (SessionRemark) suivent la même règle : seuil exprimé en pourcentage de l'allure, jamais en valeur absolue qui tombe dans le bruit GPS, et vérifié sur toutes les séances.

## Deux versions : mobile (android/) et PC (desktop/, Tauri)

Toute modification de logique commune (détection, charge, santé, anonymisation, formats) se vérifie sur les deux : `scripts/verifier-tout.sh`. Le noyau PC (`desktop/core`) est le portage TS du Kotlin : un changement d'un côté se reporte de l'autre, avec les mêmes cas de test. Plan : `docs/plans/version-pc.md`.

## Synchronisation

Toute étape qui attend le réseau affiche ce qu'elle attend et depuis quand, a un délai maximum, et peut être passée.

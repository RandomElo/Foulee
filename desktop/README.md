# Foulée pour ordinateur

Version bureau de Foulée (Linux d'abord, Windows et macOS ensuite) : Tauri 2, React, TypeScript, Tailwind. Local first : les données restent sur ta machine, dans une base SQLite chiffrée (SQLCipher) dont la clé est gardée par le trousseau du système.

## Lancer l'application

Prérequis : Node 22 ou plus, Rust (rustup) et, sous Linux, les bibliothèques de Tauri (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`).

```bash
cd desktop
npm install
npm run dev
```

La fenêtre s'ouvre. Au premier lancement la base est vide : dans un build de développement, le bouton « Charger des données de démo » (accueil ou Profil) remplit l'appli de séances fictives pour tout essayer sans compte.

Pour voir l'interface dans un navigateur, sans Tauri (données de démo en mémoire, rien n'est enregistré) :

```bash
cd desktop/app
npx vite --port 1420
```

puis ouvre http://localhost:1420.

## Connexions : Garmin, Strava, Nolio

Aucun mot de passe n'est gardé.

- **Garmin** (source principale : séances, tours de la montre, santé, prénom) : tu saisis ton e-mail et ton mot de passe dans Profil, comme dans l'appli du téléphone, et le code de
  vérification si Garmin en demande un. L'appli ouvre la session sans navigateur (même flux que l'appli Android : connexion SSO mobile, jeton OAuth1, jeton OAuth2). Le mot de passe sert une fois ;
  seul le jeton OAuth1 est rangé dans le trousseau du système (« Déconnecter » l'efface).
- **Strava** (optionnel : nom, description et labels) et **Nolio** (optionnel : séances prévues par ton coach, objectifs) n'ont pas d'API accessible : tu te connectes dans l'appli (Nolio : e-mail et mot de passe ; Strava : e-mail puis code reçu par e-mail, car Google refuse
  les navigateurs pilotés), le navigateur travaille sans fenêtre, aucun identifiant n'est gardé, puis l'appli lit tes données avec le navigateur (Chrome, Edge ou Chromium installé, sinon Chrome for Testing téléchargé depuis Profil, Avancé),
  en lecture seule, à faible cadence. La session reste dans un profil du navigateur dédié à l'appli, jamais dans ton profil de tous les jours.

Les adresses internes de ces trois services ne sont pas documentées : elles ont été repérées sur une vraie session et peuvent changer, auquel cas l'appli le dit au lieu de deviner.

## Vérifier

```bash
cd desktop
npm run verifier   # types, tests du noyau et de l'app, build web, compilation Rust, tests Rust
```

Depuis la racine du dépôt, `scripts/verifier-tout.sh` vérifie aussi la version Android et la parité des calculs entre les deux.

## Organisation

- `core/` : calculs en TypeScript pur (détection du fractionné, charge, forme, semaines), identiques à ceux de l'appli Android ; testés contre des références générées par le Kotlin.
- `app/` : l'interface (React) et la coque Tauri (`src-tauri/`, Rust : base chiffrée, trousseau).
- `mcp/` : serveur MCP local (à venir).

Thèmes : Néo (toujours clair, comme sur le téléphone) et Foulée (clair et sombre), mode automatique par défaut (réglage dans Profil). Les couleurs sont définies à un seul endroit (`app/src/theme/themes.ts`) et leurs contrastes sont testés.

## Serveur MCP local (lecture seule)

L'application contient un serveur MCP (stdio) qui laisse un assistant (Claude, Codex, Copilot) lire tes séances et ton calendrier Nolio. Il ne fait rien d'autre :
la base est ouverte en lecture seule avec la clé du trousseau, aucun outil n'écrit, et les adresses e-mail, numéros de téléphone et liens sont masqués dans les noms et commentaires.

Outils : `seances_recentes` (derniers jours), `seance` (une séance avec ses tours et ton ressenti), `nolio_calendrier` (séances prévues et compétitions à venir ; `allure_plafond`
vaut 1 quand l'allure prévue est une limite à ne pas dépasser, comme sur un footing, et non une cible), `sante` (FC au repos, sommeil, VFC, stress, pas, un jour par ligne) et `ressentis` (tes effort perçu, jambes, douleur et notes, avec le jour et le titre de la séance).

Le programme est l'application elle-même avec l'option `--mcp` (ouvre Foulée une première fois pour créer la base et la clé).

Claude Code :

```bash
claude mcp add foulee -- ~/Applications/Foulee.AppImage --mcp
```

Autres clients (fichier de configuration MCP du client) :

```json
{ "mcpServers": { "foulee": { "command": "/chemin/vers/Foulee.AppImage", "args": ["--mcp"] } } }
```

Sous Windows, une version installée sans console n'écrit pas sur la sortie standard : le serveur MCP y reste à vérifier.

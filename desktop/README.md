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

## Identifiants Garmin et Nolio

Deux façons, jamais dans le code ni dans un fichier suivi par git :

1. Dans l'appli : Profil, carte « Sources ». Les valeurs partent directement dans le trousseau du système ; l'interface ne peut pas les relire.
2. En développement : copie `desktop/.env.example` en `desktop/.env` (ignoré par git), remplis les valeurs. Au lancement d'un build de développement, elles sont rangées dans le trousseau si elles n'y sont pas déjà. Un build de production ne lit aucun `.env`.

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

#!/usr/bin/env bash
# Vérifie les deux versions de Foulée d'un coup : mobile (Android) puis PC (Tauri).
# À lancer après toute modification de la logique commune (détection, charge, anonymisation…).
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Mobile : compilation Kotlin (Android) =="
(cd "$RACINE/android" && ./gradlew --console=plain compileDebugKotlin)

BANC="$HOME/demo-claude/foulee/detection"
if [ -x "$BANC/run.sh" ]; then
  echo "== Mobile : banc de détection (synthétique) =="
  (cd "$BANC" && ./build.sh && ./run.sh synth)
else
  echo "== Banc de détection absent ($BANC) : étape ignorée =="
fi

echo "== PC : types, tests du noyau, build web, compilation Rust =="
(cd "$RACINE/desktop" && npm run verifier)

echo "OK : mobile et PC vérifiés."

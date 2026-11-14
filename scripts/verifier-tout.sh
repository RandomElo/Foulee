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
  echo "== Parité : le Kotlin conclut-il toujours comme la référence du PC ? =="
  TMP="$(mktemp)"
  (cd "$BANC" && ./run.sh export-synth "$TMP" >/dev/null)
  if ! cmp -s "$TMP" "$RACINE/desktop/core/fixtures/synth.json"; then
    echo "ÉCART : la détection Kotlin a changé. Reporte la modification dans desktop/core/src/intervals.ts,"
    echo "puis régénère la référence : (cd $BANC && ./run.sh export-synth $RACINE/desktop/core/fixtures/synth.json)"
    rm -f "$TMP"; exit 1
  fi
  (cd "$BANC" && ./run.sh export-charge "$TMP" >/dev/null)
  if ! cmp -s "$TMP" "$RACINE/desktop/core/fixtures/charge.json"; then
    echo "ÉCART : le calcul de charge, de forme ou de catégories Kotlin a changé. Reporte-le dans desktop/core/src,"
    echo "puis régénère : (cd $BANC && ./run.sh export-charge $RACINE/desktop/core/fixtures/charge.json)"
    rm -f "$TMP"; exit 1
  fi
  rm -f "$TMP"
  if [ -f "$BANC/laps-reels.tsv" ]; then
    (cd "$BANC" && ./run.sh export-reels laps-reels.tsv "$RACINE/desktop/core/fixtures-locales/reels.json" >/dev/null)
  fi
else
  echo "== Banc de détection absent ($BANC) : étape ignorée =="
fi

echo "== PC : types, tests du noyau, build web, compilation Rust =="
(cd "$RACINE/desktop" && npm run verifier)

echo "OK : mobile et PC vérifiés."

#!/usr/bin/env bash
# Construit l'AppImage de Foulée (sauf avec --sans-build) et l'installe pour l'utilisateur courant : ~/Applications/Foulee.AppImage,
# le lanceur du menu et son icône. Sans sudo, relançable sans risque. Si Foulée est ouverte, elle voit le fichier remplacé et propose « Mettre à jour ».
set -euo pipefail
ici="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ici"

if [[ "${1:-}" != "--sans-build" ]]; then
  (cd app && NO_STRIP=1 npx tauri build --bundles appimage)
fi

source_appimage="$(ls -t app/src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -n 1 || true)"
[[ -n "$source_appimage" ]] || { echo "Aucune AppImage trouvée : lance d'abord sans --sans-build." >&2; exit 1; }

dest="$HOME/Applications/Foulee.AppImage"
mkdir -p "$HOME/Applications"
# Copie à côté puis renommage : l'ancienne version, peut-être en cours d'exécution, reste intacte jusqu'au dernier instant,
# et le remplacement se voit d'un coup (c'est ce que surveille l'appli).
cp "$source_appimage" "$dest.neuf"
chmod +x "$dest.neuf"
mv -f "$dest.neuf" "$dest"

for taille in 32 128; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${taille}x${taille}/apps"
  cp "app/src-tauri/icons/${taille}x${taille}.png" "$HOME/.local/share/icons/hicolor/${taille}x${taille}/apps/foulee-eloi.png"
done

mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/foulee.desktop" <<LANCEUR
[Desktop Entry]
Type=Application
Name=Foulée
Comment=Ton entraînement de course à pied
Exec="$dest" %U
Icon=foulee-eloi
Terminal=false
Categories=Sports;
LANCEUR

gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
echo "Foulée est installée : $dest, et dans le menu."

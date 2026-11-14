import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Relance l'appli sur le fichier installé (la nouvelle version). */
export const relancer = () => invoke<void>("maj_relancer");

/**
 * Vrai quand l'installeur a posé une nouvelle version depuis le lancement : l'interface propose alors « Mettre à jour ».
 * Dans un navigateur (développement), il n'y a rien à surveiller : toujours faux.
 */
export function useMiseAJour(): boolean {
  // Développement : ajouter ?maj à l'adresse pour voir le bouton (retiré de la version livrée).
  const [dispo, setDispo] = useState(import.meta.env.DEV && new URLSearchParams(window.location.search).has("maj"));
  useEffect(() => {
    if (!dansTauri) return;
    let fini = false;
    let arreter: (() => void) | undefined;
    invoke<boolean>("maj_en_attente").then((v) => { if (!fini && v) setDispo(true); }).catch(() => undefined);
    listen("maj-disponible", () => setDispo(true)).then((off) => { if (fini) off(); else arreter = off; }).catch(() => undefined);
    return () => { fini = true; arreter?.(); };
  }, []);
  return dispo;
}

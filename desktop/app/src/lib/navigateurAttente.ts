import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/** Le nom de la source qui utilise le navigateur pendant qu'une autre demande attend son tour (« Nolio », « Strava »), ou null s'il n'y a pas d'attente. */
export function useNavigateurPris(): string | null {
  const [par, setPar] = useState<string | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    let arrete = false;
    listen<string | null>("navigateur-attente", (e) => setPar(e.payload ?? null)).then((o) => { if (arrete) o(); else off = o; }).catch(() => undefined);
    return () => { arrete = true; off?.(); };
  }, []);
  return par;
}

/** La phrase de l'attente, seulement si c'est une autre source qui occupe le navigateur. */
export const phraseAttente = (par: string | null, moi: string): string | null => (par && par !== moi ? `${par} utilise le navigateur : ça démarre juste après.` : null);

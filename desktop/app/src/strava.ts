import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { select } from "./db";

export interface BilanStrava { pages: number; nouvelles: number; modifiees: number; ignorees: string[] }
export interface EtatStrava { total: number; dernier: string | null }

interface Api {
  etat(): Promise<EtatStrava>;
  /** Ouvre une fenêtre sur Strava ; rend la main quand tu es connecté (ou en erreur si tu la fermes, annules, ou attends trop). */
  connecter(): Promise<void>;
  /** `complet` : toute la liste ; sinon seulement les pages récentes. */
  synchroniser(complet: boolean, onProgress: (page: number, pages: number) => void): Promise<BilanStrava>;
  annuler(): Promise<void>;
}

const tauri: Api = {
  async etat() {
    const [l] = await select<{ n: number; dernier: string | null }>("SELECT count(*) AS n, max(lu_le) AS dernier FROM strava_activites");
    return { total: l?.n ?? 0, dernier: l?.dernier ?? null };
  },
  connecter: () => invoke<void>("strava_connecter"),
  async synchroniser(complet, onProgress) {
    const off = await listen<{ recus: number; total: number }>("strava-progression", (e) => onProgress(e.payload.recus, e.payload.total));
    try { return await invoke<BilanStrava>("strava_synchroniser", { complet }); } finally { off(); }
  },
  annuler: () => invoke<void>("nolio_annuler"),
};

/** Navigateur web (développement seulement) : pas de pilotage possible, on le dit au lieu de faire semblant. */
const absent: Api = {
  etat: async () => ({ total: 0, dernier: null }),
  connecter: async () => { throw new Error("disponible seulement dans l'application"); },
  synchroniser: async () => { throw new Error("disponible seulement dans l'application"); },
  annuler: async () => undefined,
};

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const strava: Api = dansTauri ? tauri : import.meta.env.DEV ? absent : tauri;

/** Une phrase pour le bilan d'une lecture. */
export function resumeBilanStrava(b: BilanStrava): string {
  const base = b.nouvelles + b.modifiees === 0 ? "Déjà à jour." : `${b.nouvelles} nouvelle${b.nouvelles > 1 ? "s" : ""}, ${b.modifiees} modifiée${b.modifiees > 1 ? "s" : ""}.`;
  return b.ignorees.length === 0 ? base : `${base} ${b.ignorees.length} activité${b.ignorees.length > 1 ? "s" : ""} illisible${b.ignorees.length > 1 ? "s" : ""}, ignorée${b.ignorees.length > 1 ? "s" : ""}.`;
}

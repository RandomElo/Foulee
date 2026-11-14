import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { select } from "./db";

export interface BilanNolio { fenetres: number; nouveaux: number; modifies: number; erreurs: string[] }
export interface EtatNolio { total: number; dernier: string | null }

interface Api {
  etat(): Promise<EtatNolio>;
  /** Connecte Nolio avec l'e-mail et le mot de passe saisis dans l'appli, dans le navigateur sans fenêtre. Rien n'est gardé : seule la session du navigateur reste. */
  connecter(email: string, motDePasse: string): Promise<void>;
  synchroniser(onProgress: (fait: number, total: number) => void): Promise<BilanNolio>;
  annuler(): Promise<void>;
}

const tauri: Api = {
  async etat() {
    const [l] = await select<{ n: number; dernier: string | null }>("SELECT count(*) AS n, max(lu_le) AS dernier FROM nolio_evenements");
    return { total: l?.n ?? 0, dernier: l?.dernier ?? null };
  },
  connecter: (email, motDePasse) => invoke<void>("nolio_connecter", { email, motDePasse }),
  async synchroniser(onProgress) {
    const off = await listen<{ recus: number; total: number }>("nolio-progression", (e) => onProgress(e.payload.recus, e.payload.total));
    try { return await invoke<BilanNolio>("nolio_synchroniser"); } finally { off(); }
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
export const nolio: Api = dansTauri ? tauri : import.meta.env.DEV ? absent : tauri;

/** Une phrase pour le bilan d'une lecture (les erreurs de fiches isolées sont comptées, pas listées). */
export function resumeBilan(b: BilanNolio): string {
  const base = b.nouveaux + b.modifies === 0 ? "Déjà à jour." : `${b.nouveaux} nouveau${b.nouveaux > 1 ? "x" : ""}, ${b.modifies} modifié${b.modifies > 1 ? "s" : ""}.`;
  return b.erreurs.length === 0 ? base : `${base} ${b.erreurs.length} fiche${b.erreurs.length > 1 ? "s" : ""} illisible${b.erreurs.length > 1 ? "s" : ""}, relis plus tard.`;
}

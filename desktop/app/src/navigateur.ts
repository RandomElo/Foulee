import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Detecte { nom: string; chemin: string }
export interface EtatNavigateur {
  installes: Detecte[];
  choisi: Detecte | null;
  copie_telechargee: boolean;
  version_epinglee: string;
  taille_telechargement: number | null;
}

interface Api {
  etat(): Promise<EtatNavigateur>;
  telecharger(onProgress: (recus: number, total: number) => void): Promise<void>;
  annuler(): Promise<void>;
  tester(): Promise<string>;
}

const tauri: Api = {
  etat: () => invoke<EtatNavigateur>("navigateur_etat"),
  async telecharger(onProgress) {
    const off = await listen<{ recus: number; total: number }>("navigateur-progression", (e) => onProgress(e.payload.recus, e.payload.total));
    try { await invoke("navigateur_telecharger"); } finally { off(); }
  },
  annuler: () => invoke("navigateur_annuler"),
  tester: () => invoke<string>("navigateur_tester"),
};

/** Navigateur web (développement seulement) : pas de pilotage possible, on le dit au lieu de faire semblant. */
const absent: Api = {
  etat: async () => ({ installes: [], choisi: null, copie_telechargee: false, version_epinglee: "–", taille_telechargement: null }),
  telecharger: async () => { throw new Error("disponible seulement dans l'application"); },
  annuler: async () => undefined,
  tester: async () => { throw new Error("disponible seulement dans l'application"); },
};

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const navigateur: Api = dansTauri ? tauri : import.meta.env.DEV ? absent : tauri;

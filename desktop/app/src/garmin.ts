import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { select } from "./db";

export interface BilanGarmin { nouvelles: number; modifiees: number; tours: number; jours: number; ignorees: string[] }
export interface EtatGarmin { total: number; dernier: string | null }

interface Api {
  etat(): Promise<EtatGarmin>;
  /** Vrai si un jeton de session Garmin est rangé dans le trousseau. */
  connecte(): Promise<boolean>;
  /** Connexion avec l'e-mail et le mot de passe (jamais gardés). Rend « ok », ou « code » avec la méthode quand Garmin demande un code de vérification. */
  connecter(email: string, motDePasse: string): Promise<{ etat: "ok" } | { etat: "code"; methode: string }>;
  /** Termine la connexion avec le code de vérification reçu. */
  envoyerCode(code: string): Promise<void>;
  /** Oublie la connexion : efface le jeton du trousseau. */
  deconnecter(): Promise<void>;
  /** `complet` : tout l'historique ; sinon les 20 dernières activités. */
  synchroniser(complet: boolean, onProgress: (etape: string, fait: number, total: number) => void): Promise<BilanGarmin>;
  annuler(): Promise<void>;
}

const tauri: Api = {
  async etat() {
    const [l] = await select<{ n: number; dernier: string | null }>("SELECT count(*) AS n, max(start_local) AS dernier FROM activities WHERE source = 'garmin'");
    return { total: l?.n ?? 0, dernier: l?.dernier ?? null };
  },
  connecte: () => invoke<boolean>("garmin_connecte"),
  async connecter(email, motDePasse) {
    const r = await invoke<string>("garmin_connecter", { email, motDePasse });
    return r.startsWith("code:") ? { etat: "code", methode: r.slice(5) } : { etat: "ok" };
  },
  envoyerCode: (code) => invoke<void>("garmin_code", { code }),
  deconnecter: () => invoke<void>("garmin_deconnecter"),
  async synchroniser(complet, onProgress) {
    const off = await listen<{ etape: string; fait: number; total: number }>("garmin-progression", (e) => onProgress(e.payload.etape, e.payload.fait, e.payload.total));
    try { return await invoke<BilanGarmin>("garmin_synchroniser", { complet }); } finally { off(); }
  },
  annuler: () => invoke<void>("garmin_annuler"),
};

/** Navigateur web (développement seulement) : pas de pilotage possible, on le dit au lieu de faire semblant. */
const absent: Api = {
  etat: async () => ({ total: 0, dernier: null }),
  connecte: async () => false,
  connecter: async () => { throw new Error("disponible seulement dans l'application"); },
  envoyerCode: async () => { throw new Error("disponible seulement dans l'application"); },
  deconnecter: async () => undefined,
  synchroniser: async () => { throw new Error("disponible seulement dans l'application"); },
  annuler: async () => undefined,
};

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const garmin: Api = dansTauri ? tauri : import.meta.env.DEV ? absent : tauri;

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Une phrase pour le bilan d'une lecture. */
export function resumeBilanGarmin(b: BilanGarmin): string {
  const morceaux = [
    b.nouvelles + b.modifiees > 0 ? `${pluriel(b.nouvelles, "nouvelle activité", "nouvelles activités")}, ${pluriel(b.modifiees, "modifiée", "modifiées")}` : "Activités à jour",
    b.tours > 0 ? pluriel(b.tours, "séance avec ses tours", "séances avec leurs tours") : null,
    b.jours > 0 ? `santé de ${pluriel(b.jours, "jour", "jours")}` : null,
  ].filter(Boolean);
  const base = `${morceaux.join(" · ")}.`;
  return b.ignorees.length === 0 ? base : `${base} ${pluriel(b.ignorees.length, "élément illisible ignoré", "éléments illisibles ignorés")}.`;
}

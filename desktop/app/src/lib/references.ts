/** Les références du coureur : VMA, records et fréquences cardiaques. Servent aux allures de course et au titre « Spé » des séances. */
export interface References {
  vma: string;
  r5: string;
  r10: string;
  semi: string;
  fcMax: string;
  fcRepos: string;
}

export const REFERENCES_VIDES: References = { vma: "", r5: "", r10: "", semi: "", fcMax: "", fcRepos: "" };
export const CLES_REFERENCES: Record<keyof References, string> = { vma: "ref-vma", r5: "ref-5km", r10: "ref-10km", semi: "ref-semi", fcMax: "ref-fc-max", fcRepos: "ref-fc-repos" };

/** « 16:48 » ou « 1:23:48 » en secondes ; null si ce n'est pas un temps. */
export function lireTemps(texte: string): number | null {
  const m = texte.trim().replace(/\s/g, "").match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] !== undefined && min > 59)) return null;
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

/** Un nombre positif (la virgule française est acceptée), ou null. */
export function lireNombre(texte: string, max: number): number | null {
  const n = Number(texte.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

export interface Erreurs { vma?: string; r5?: string; r10?: string; semi?: string; fcMax?: string; fcRepos?: string }

/** Ce qui est écrit mais faux ; un champ vide n'est pas une erreur (tout est facultatif). */
export function verifier(r: References): Erreurs {
  const e: Erreurs = {};
  if (r.vma.trim() && lireNombre(r.vma, 30) === null) e.vma = "Un nombre, par exemple 19,2";
  if (r.r5.trim() && lireTemps(r.r5) === null) e.r5 = "Comme 16:48";
  if (r.r10.trim() && lireTemps(r.r10) === null) e.r10 = "Comme 37:02";
  if (r.semi.trim() && lireTemps(r.semi) === null) e.semi = "Comme 1:23:48";
  if (r.fcMax.trim() && lireNombre(r.fcMax, 250) === null) e.fcMax = "Entre 1 et 250";
  if (r.fcRepos.trim() && lireNombre(r.fcRepos, 150) === null) e.fcRepos = "Entre 1 et 150";
  const max = lireNombre(r.fcMax, 250), repos = lireNombre(r.fcRepos, 150);
  if (!e.fcMax && !e.fcRepos && max !== null && repos !== null && repos >= max) e.fcRepos = "Plus basse que la FC max";
  return e;
}

/** Les références qui manquent, pour prévenir une fois avant de continuer. */
export function manquantes(r: References): string[] {
  const m: string[] = [];
  if (!r.vma.trim()) m.push("la VMA");
  if (!r.r5.trim() || !r.r10.trim() || !r.semi.trim()) m.push("tes records");
  if (!r.fcMax.trim() || !r.fcRepos.trim()) m.push("tes fréquences cardiaques");
  return m;
}

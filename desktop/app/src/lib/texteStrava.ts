import { buildEasy, buildInterval, categoryOf, proposedSpeciality, type IntervalAnalysis, type RefsNum, type StravaText } from "@foulee/core";
import type { Seance } from "../repo";
import { lireNombre, lireTemps, type References } from "./references";

/** Les références écrites par l'utilisateur, en nombres (0 = inconnue) pour calculer les allures de course. */
export function refsNumeriques(r: References): RefsNum {
  return { vma: lireNombre(r.vma, 30) ?? 0, rec5: lireTemps(r.r5) ?? 0, rec10: lireTemps(r.r10) ?? 0, recHalf: lireTemps(r.semi) ?? 0 };
}

/** Le nom et la description que l'appli mettrait sur Strava pour cette séance : fractionné avec « Spé » si les allures le justifient, footing, sortie longue. Rien pour les autres. */
export function texteStravaDe(s: Seance, analyse: IntervalAnalysis | null, charge: number | null, refs: References): { texte: StravaText; specialite: string | null } | null {
  const cat = categoryOf(s);
  if (cat === "interval" && analyse && analyse.groups.length > 0) {
    const specialite = proposedSpeciality(analyse, refsNumeriques(refs));
    return { texte: buildInterval(analyse, charge, null, specialite), specialite };
  }
  if (cat === "easy" || cat === "long") {
    const t = buildEasy(s, cat, charge);
    return t ? { texte: t, specialite: null } : null;
  }
  return null;
}

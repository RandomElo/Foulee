import { buildEasy, buildInterval, categoryOf, proposedSpeciality, type IntervalAnalysis, type RefsNum, type StravaText } from "@foulee/core";
import type { Seance } from "../repo";
import { lireNombre, lireTemps, type References } from "./references";

/** Les références écrites par l'utilisateur, en nombres (0 = inconnue) pour calculer les allures de course. */
export function refsNumeriques(r: References): RefsNum {
  return { vma: lireNombre(r.vma, 30) ?? 0, rec5: lireTemps(r.r5) ?? 0, rec10: lireTemps(r.r10) ?? 0, recHalf: lireTemps(r.semi) ?? 0 };
}

export interface ContexteTexte {
  charge: number | null;
  refs: References;
  remarque: string | null;
  /** Le « Spé » que l'utilisateur a choisi d'afficher dans le titre (jamais appliqué tout seul). */
  specialiteChoisie: string | null;
  /** Les lignes du bilan de la semaine, le dimanche. */
  semaine: string[] | null;
  /** La ligne « Récupération faible ce matin », quand c'est le cas. */
  recuperation: string | null;
}

/**
 * Le nom et la description que l'appli mettrait sur Strava pour cette séance : fractionné, footing, sortie longue ; rien pour les autres.
 * `proposee` est la spécialité que les allures suggèrent (« 5 km »…) : elle n'entre dans le titre que si l'utilisateur la choisit.
 */
export function texteStravaDe(s: Seance, analyse: IntervalAnalysis | null, c: ContexteTexte): { texte: StravaText; proposee: string | null } | null {
  const cat = categoryOf(s);
  if (cat === "interval" && analyse && analyse.groups.length > 0) {
    const proposee = proposedSpeciality(analyse, refsNumeriques(c.refs));
    return { texte: buildInterval(analyse, c.charge, c.remarque, c.specialiteChoisie, c.semaine, c.recuperation), proposee };
  }
  if (cat === "easy" || cat === "long") {
    const t = buildEasy(s, cat, c.charge, c.semaine, c.recuperation);
    return t ? { texte: t, proposee: null } : null;
  }
  return null;
}

import { dayOf } from "@foulee/core";
import type { NolioEvt, Seance } from "../repo/types";
import { fmtPace } from "./format";

const minuit = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export const joursEntre = (a: string, b: string): number => Math.round((minuit(b) - minuit(a)) / 86_400_000);

/** Les prochaines séances prévues (compétitions à part), de aujourd'hui inclus, dans l'ordre. */
export function aVenir(nolio: NolioEvt[], today: string, max = 3): NolioEvt[] {
  return nolio
    .filter((e) => e.genre === "prevu" && !e.competition && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.heure ?? "").localeCompare(b.heure ?? "") || a.id.localeCompare(b.id))
    .slice(0, max);
}

/** La prochaine compétition prévue, avec le nombre de jours qui en restent. */
export function prochainObjectif(nolio: NolioEvt[], today: string): { evt: NolioEvt; jours: number } | null {
  const e = nolio.filter((x) => x.genre === "prevu" && x.competition && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return e ? { evt: e, jours: joursEntre(today, e.date) } : null;
}

export const dansJours = (n: number): string => (n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`);

/** La séance prévue de ce jour-là qui correspond à une séance réalisée : la plus proche en durée, sinon la première. */
export function prevuDe(nolio: NolioEvt[], s: Seance): NolioEvt | null {
  const memeJour = nolio.filter((e) => e.genre === "prevu" && e.date === dayOf(s));
  if (memeJour.length === 0) return null;
  const ecart = (e: NolioEvt) => (e.dureeS !== null && s.duration !== null ? Math.abs(e.dureeS - s.duration) : Number.MAX_SAFE_INTEGER);
  return [...memeJour].sort((a, b) => ecart(a) - ecart(b))[0] ?? null;
}

/** « 4 min 55 / km » (selon le format du reste de l'appli) pour une allure en secondes au kilomètre. */
export const fmtAllure = (sKm: number | null): string => (sKm === null || sKm <= 0 ? "–" : fmtPace(1000 / sKm));

/** Pour une allure plafond : « sous la limite » ou « au-dessus », jamais un écart à une allure qui n'est pas une cible. */
export function positionSousLimite(e: NolioEvt, vitesseReelle: number | null): "sous" | "au-dessus" | null {
  if (!e.allurePlafond || e.allureSKm === null || vitesseReelle === null || vitesseReelle <= 0) return null;
  return vitesseReelle <= 1000 / e.allureSKm ? "sous" : "au-dessus";
}

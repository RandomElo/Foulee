// Zones de charge globale et nombre de séances d'un jour : portage de LoadZones et SessionCount (Coaching.kt).
import { categoryOf } from "./categories";
import { localMillis } from "./dates";
import { dayOf, type ActivityRow } from "./model";

export interface LoadZone { index: number; label: string; from: number; to: number; meaning: string }

const LABELS = ["Sous-entraînement", "Entraînement léger", "Maintien", "Progression", "Surcharge"];
const MEANINGS = [
  "Charge très basse : si ça dure, tu perds un peu de forme.",
  "Semaine allégée : bonne pour récupérer, peu de progrès.",
  "Tu entretiens ta forme sans la pousser.",
  "Une charge qui fait progresser et que tu absorbes bien.",
  "Tu charges plus que tu ne récupères : surveille ta forme et allège les prochains jours.",
];
export const ZONE_BOUNDS = [5, 9, 13, 17];
export const LOAD_ZONES: LoadZone[] = LABELS.map((label, i) => ({
  index: i, label, from: i === 0 ? 0 : (ZONE_BOUNDS[i - 1] as number), to: i === ZONE_BOUNDS.length ? 20 : (ZONE_BOUNDS[i] as number), meaning: MEANINGS[i] as string,
}));
export const loadZoneOf = (value: number): LoadZone => LOAD_ZONES[ZONE_BOUNDS.filter((b) => value >= b).length] as LoadZone;

const NEAR_MINUTES = 45;
const MAX_MINUTES = 45;
const start = (a: ActivityRow) => localMillis(a.startLocal);
const end = (a: ActivityRow) => start(a) + Math.trunc(a.duration ?? 0) * 1000;
const minutesBetween = (a: number, b: number) => Math.trunc((b - a) / 60_000);

/**
 * Un échauffement et un retour au calme autour d'une séance dure n'en sont pas : ils sont absorbés.
 * Une séance dure est un fractionné ou une compétition (même règle côté Kotlin, Coaching.kt).
 */
export function sessionsOfDay(runs: ActivityRow[]): number {
  const sorted = [...runs].sort((a, b) => (a.startLocal < b.startLocal ? -1 : a.startLocal > b.startLocal ? 1 : 0));
  const absorbed = sorted.map(() => false);
  const hard = (a: ActivityRow) => categoryOf(a) === "interval" || categoryOf(a) === "competition";
  sorted.forEach((a, i) => {
    if (!hard(a)) return;
    const takes = (j: number, gap: number) => {
      const other = sorted[j];
      if (!other) return;
      if (!hard(other) && !absorbed[j] && (other.duration ?? 0) <= MAX_MINUTES * 60 && gap <= NEAR_MINUTES) absorbed[j] = true;
    };
    if (i > 0) takes(i - 1, minutesBetween(end(sorted[i - 1] as ActivityRow), start(a)));
    if (i < sorted.length - 1) takes(i + 1, minutesBetween(end(a), start(sorted[i + 1] as ActivityRow)));
  });
  return absorbed.filter((x) => !x).length;
}

export function countSessions(runs: ActivityRow[]): number {
  const byDay = new Map<string, ActivityRow[]>();
  for (const r of runs) byDay.set(dayOf(r), [...(byDay.get(dayOf(r)) ?? []), r]);
  let n = 0;
  for (const list of byDay.values()) n += sessionsOfDay(list);
  return n;
}

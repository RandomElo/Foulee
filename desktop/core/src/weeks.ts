// Semaines (du lundi au dimanche) : regroupement des séances et kilomètres par semaine.
import { addDays } from "./dates";
import { dayOf, isRun, type ActivityRow } from "./model";

/** Le lundi de la semaine de `iso` (AAAA-MM-JJ). */
export function weekStart(iso: string): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  return addDays(iso, -dow);
}

export interface Week<T extends ActivityRow = ActivityRow> { start: string; end: string; km: number; sessions: T[] }

/** Kilomètres de course d'une liste de séances, arrondis à 0,1. */
export const runKm = (list: ActivityRow[]): number => Math.round(list.filter(isRun).reduce((s, a) => s + (a.distance ?? 0) / 1000, 0) * 10) / 10;

/** Les semaines qui ont au moins une séance, de la plus récente à la plus ancienne ; séances de la plus récente à la plus ancienne. */
export function groupWeeks<T extends ActivityRow>(activities: T[]): Week<T>[] {
  const by = new Map<string, T[]>();
  for (const a of activities) {
    const w = weekStart(dayOf(a));
    by.set(w, [...(by.get(w) ?? []), a]);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([start, list]) => ({ start, end: addDays(start, 6), km: runKm(list), sessions: [...list].sort((x, y) => (x.startLocal < y.startLocal ? 1 : -1)) }));
}

export interface WeekKm { start: string; km: number; current: boolean }

/** Kilomètres des `count` dernières semaines (la semaine en cours comprise), y compris celles sans séance. */
export function kmPerWeek(activities: ActivityRow[], today: string, count = 8): WeekKm[] {
  const cur = weekStart(today);
  const out: WeekKm[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(cur, -7 * i);
    const end = addDays(start, 6);
    out.push({ start, km: runKm(activities.filter((a) => dayOf(a) >= start && dayOf(a) <= end)), current: i === 0 });
  }
  return out;
}

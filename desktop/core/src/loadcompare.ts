// Les 7 derniers jours contre les trois semaines d'avant, séance par séance : portage de LoadCompare.kt.
import { CATEGORIES, categoryOf, type Category } from "./categories";
import { addDays } from "./dates";
import { dec } from "./format";
import { round1, type Analysis } from "./insights";
import { dayOf, isRun, type ActivityRow } from "./model";

export interface WindowSession { activity: ActivityRow; category: Category; km: number; points: number }
export interface LoadWindow { from: string; to: string; points: number; km: number; sessions: WindowSession[] }
export interface CategoryDiff { category: string; label: string; count: number; avgCount: number; points: number; avgPoints: number; delta: number }
export interface LoadComparison { current: LoadWindow; previous: LoadWindow[]; avgPoints: number; avgKm: number; delta: number; categories: CategoryDiff[]; explanation: string }

const NOUNS: Record<string, string> = {
  competition: "compétitions", interval: "fractionné", long: "sorties longues", easy: "footings", strength: "musculation", other: "autres sports",
};
export function pluralLabel(category: string): string {
  switch (category) {
    case "competition": return "Compétitions";
    case "interval": return "Fractionnés";
    case "long": return "Sorties longues";
    case "easy": return "Footings";
    case "strength": return "Musculation";
    default: return "Autres sports";
  }
}
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const join = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`);

export function compareLoad(activities: ActivityRow[], analysis: Pick<Analysis, "pointsOf">, today: string): LoadComparison {
  const start = addDays(today, -27);
  const sessions: WindowSession[] = activities
    .filter((a) => dayOf(a) >= start)
    .map((a) => ({ activity: a, category: categoryOf(a), km: isRun(a) ? round1((a.distance ?? 0) / 1000) : 0, points: analysis.pointsOf(a) ?? 0 }));
  const window = (k: number): LoadWindow => {
    const to = addDays(today, -7 * k);
    const from = addDays(to, -6);
    const list = sessions.filter((s) => dayOf(s.activity) >= from && dayOf(s.activity) <= to);
    return { from, to, points: round1(sum(list.map((s) => s.points))), km: Math.round(sum(list.map((s) => s.km))), sessions: list };
  };
  const current = window(0);
  const previous = [1, 2, 3].map(window);
  const avgPoints = round1(sum(previous.map((w) => w.points)) / 3);
  const avgKm = Math.round(sum(previous.map((w) => w.km)) / 3);
  const categories = CATEGORIES.map((category) => {
    const mine = current.sessions.filter((s) => s.category === category);
    const before = previous.flatMap((w) => w.sessions.filter((s) => s.category === category));
    const points = round1(sum(mine.map((s) => s.points)));
    const avg = round1(sum(before.map((s) => s.points)) / 3);
    return { category, label: pluralLabel(category), count: mine.length, avgCount: round1(before.length / 3), points, avgPoints: avg, delta: round1(points - avg) } as CategoryDiff;
  })
    .filter((c) => c.count > 0 || c.avgCount > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const delta = round1(current.points - avgPoints);
  return { current, previous, avgPoints, avgKm, delta, categories, explanation: explain(current, avgPoints, delta, categories) };
}

function explain(current: LoadWindow, avgPoints: number, delta: number, categories: CategoryDiff[]): string {
  const d1 = (v: number) => dec(v, 1);
  if (Math.abs(delta) < 0.8) return `Charge stable : ${d1(current.points)} cette semaine glissante, contre ${d1(avgPoints)} en moyenne les trois semaines d'avant.`;
  const up = delta > 0;
  const reasons = categories
    .filter((c) => Math.abs(c.delta) >= 0.6 && sign(c.delta) === sign(delta))
    .slice(0, 2)
    .map((c) => `${c.delta > 0 ? "plus" : "moins"} de ${NOUNS[c.category]} (${c.count} contre ${d1(c.avgCount)} par semaine avant)`);
  const head = `Charge en ${up ? "hausse" : "baisse"} de ${d1(Math.abs(delta))} point${Math.abs(delta) >= 2 ? "s" : ""}`;
  const against = categories.find((c) => Math.abs(c.delta) >= 1 && sign(c.delta) !== sign(delta));
  const counter = against ? `, même si tu as fait ${against.delta > 0 ? "plus" : "moins"} de ${NOUNS[against.category]} (${against.count} contre ${d1(against.avgCount)})` : "";
  return reasons.length > 0
    ? `${head}, surtout parce que tu as fait ${join(reasons)}${counter}.`
    : `${head}, sans type de séance qui ressorte : c'est l'ensemble qui est ${up ? "plus" : "moins"} chargé${counter}.`;
}

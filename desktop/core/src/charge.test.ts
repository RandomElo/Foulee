import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeLoad, categoryOf, compareLoad, computeSplits, countSessions, loadZoneOf, isRun, type ActivityRow, type DailyRow, type Readiness, type GlobalParts, type Sample } from "./index";

/** Référence : ce que le Kotlin (Insights, GlobalLoad, LoadCompare, Categories, Splits) calcule sur des données synthétiques. Banc : export-charge. */
const ref = JSON.parse(readFileSync(new URL("../fixtures/charge.json", import.meta.url), "utf8"));

/** Compare deux valeurs : nombres à 1e-9 près (les sommes flottantes peuvent différer d'un ulp), le reste à l'identique. */
function egal(a: unknown, b: unknown, chemin: string, ecarts: string[]) {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) ecarts.push(`${chemin}: ${a} ≠ ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) ecarts.push(`${chemin}: longueur ${a.length} ≠ ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) egal(a[i], b[i], `${chemin}[${i}]`, ecarts);
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(b as object);
    for (const k of ka) egal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${chemin}.${k}`, ecarts);
  } else if (a !== b) ecarts.push(`${chemin}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const toActivity = (r: Record<string, unknown>): ActivityRow => ({
  id: r.id as number, startLocal: r.startLocal as string, type: r.type as string, distance: r.distance as number | null, duration: r.duration as number | null,
  averageSpeed: r.averageSpeed as number | null, averageHr: r.averageHr as number | null, maxHr: r.maxHr as number | null, trainingLoad: r.trainingLoad as number | null,
  name: r.name as string, elevation: r.elevation as number | null, intervalTitle: r.intervalTitle as string | null, manualCategory: r.manualCategory as string | null,
  trimp: r.trimp as number | null, stravaLabels: r.stravaLabels as string[] | null,
});

const jeux = ref.charge as Record<string, any>[];

describe("charge, forme et catégories : parité avec le Kotlin", () => {
  jeux.forEach((c, n) => {
    const acts = (c.activities as Record<string, unknown>[]).map(toActivity);
    const daily = c.daily as DailyRow[];
    const an = analyzeLoad(acts, daily, c.today, { hrMax: c.hrMax, hrRest: c.hrRest });

    it(`jeu ${n + 1} : repères, courbe de charge et fatigue`, () => {
      const e: string[] = [];
      egal(an.refs, c.refs, "refs", e);
      egal(an.weekRef, c.weekRef, "weekRef", e);
      egal(an.previousWeek, c.previousWeek, "previousWeek", e);
      egal(an.load, c.load, "load", e);
      expect(e.slice(0, 5)).toEqual([]);
    });
    it(`jeu ${n + 1} : forme du jour et forme de jours choisis`, () => {
      const e: string[] = [];
      egal(an.readiness, c.readiness, "readiness", e);
      for (const x of c.readinessOn as { date: string; r: Readiness | null }[]) {
        const d = new Date(Date.parse(x.date) - 86_400_000).toISOString().slice(0, 10);
        egal(an.readinessOn(x.date, d), x.r, `readinessOn ${x.date}`, e);
      }
      expect(e.slice(0, 5)).toEqual([]);
    });
    it(`jeu ${n + 1} : charge globale d'un jour et après chaque séance`, () => {
      const e: string[] = [];
      for (const x of c.globalOn as { date: string; p: GlobalParts | null }[]) egal(an.globalPartsOn(x.date), x.p, `globalOn ${x.date}`, e);
      for (const x of c.perActivity as Record<string, unknown>[]) {
        const a = acts.find((y) => y.id === x.id) as ActivityRow;
        egal(categoryOf(a), x.category, `catégorie ${a.id}`, e);
        egal(an.loadOf(a), x.loadOf, `loadOf ${a.id}`, e);
        egal(an.effortOf(a), x.effortOf, `effortOf ${a.id}`, e);
        egal(an.pointsOf(a), x.pointsOf, `pointsOf ${a.id}`, e);
        egal(an.weekLoadOn(a), x.weekLoadOn, `weekLoadOn ${a.id}`, e);
        egal(an.globalAfter(a), x.globalAfter, `globalAfter ${a.id}`, e);
      }
      expect(e.slice(0, 5)).toEqual([]);
    });
    it(`jeu ${n + 1} : comparaison avec les semaines d'avant et nombre de séances`, () => {
      const e: string[] = [];
      const cmp = compareLoad(acts, an, c.today);
      const w = (l: typeof cmp.current) => ({ from: l.from, to: l.to, points: l.points, km: l.km, sessions: l.sessions.map((s) => ({ id: s.activity.id, category: s.category, km: s.km, points: s.points })) });
      egal({ current: w(cmp.current), previous: cmp.previous.map(w), avgPoints: cmp.avgPoints, avgKm: cmp.avgKm, delta: cmp.delta, categories: cmp.categories, explanation: cmp.explanation }, c.compare, "compare", e);
      const parJour = new Map<string, ActivityRow[]>();
      for (const a of acts) parJour.set(a.startLocal.slice(0, 10), [...(parJour.get(a.startLocal.slice(0, 10)) ?? []), a]);
      for (const x of c.sessionCount as { date: string; n: number }[]) egal(countSessions((parJour.get(x.date) as ActivityRow[]).filter(isRun)), x.n, `séances ${x.date}`, e);
      expect(e.slice(0, 5)).toEqual([]);
    });
  });

  it("zones de charge", () => {
    for (const z of ref.zones as { v: number; label: string; index: number }[]) {
      const r = loadZoneOf(z.v);
      expect([r.label, r.index]).toEqual([z.label, z.index]);
    }
  });

  it("temps au kilomètre", () => {
    (ref.splits as { samples: Sample[]; splits: unknown[] }[]).forEach((s, i) => {
      const e: string[] = [];
      egal(computeSplits(s.samples), s.splits, `splits ${i}`, e);
      expect(e.slice(0, 5)).toEqual([]);
    });
  });
});

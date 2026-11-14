// Charge, fatigue et forme du jour : portage de Insights.kt (le chargement depuis la base en moins).
import { categoryOf } from "./categories";
import { addDays, daysBetween } from "./dates";
import { dec, roundToInt } from "./format";
import { GlobalLoadModel, type GlobalCore } from "./globalload";
import { dayOf, isRun, type ActivityRow, type DailyRow } from "./model";
import { sessionsOfDay } from "./sessions";

export const TRIMP_TO_LOAD = 1.3;
const WEEK = 7;
const MONTH = 28;
const FATIGUE_WEIGHT = 0.15;
const MIN_HISTORY = 7;

export interface HrRefs { rest: number; max: number }
export interface UserHr { hrMax: number; hrRest: number }

export interface Factor {
  key: string; label: string; display: string; note: string; baselineDisplay: string | null; z: number; value: number; baseline: number | null;
  /** « good », « normal » ou « low » */
  status: "good" | "normal" | "low";
}
export interface Readiness { date: string; score: number; label: string; factors: Factor[] }
export interface LoadPoint { date: string; week: number; month: number; fatigue: number | null; weekKm: number; weekSessions: number; monthKm: number; monthSessions: number }
export interface GlobalParts {
  total: number; trainingRatio: number; volumeRatio: number | null; ratio: number; deficit: number; unfavorable: [string, number][];
  hasNight: boolean; hasWatch: boolean; weekKm: number; weekSessions: number; readiness: number | null;
}

export const round1 = (v: number) => roundToInt(v * 10) / 10;
const on20 = (v: number, ref: number) => round1(Math.min((20 * v) / ref, 20));
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
export const mean = (v: number[]) => (v.length === 0 ? 0 : sum(v) / v.length);
function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(sum(v.map((x) => (x - m) * (x - m))) / (v.length - 1));
}
function percentile(values: number[], p: number): number {
  const sorted = values.filter((x) => x > 0).sort((a, b) => a - b);
  return sorted.length === 0 ? 1.0 : (sorted[Math.min(sorted.length - 1, Math.trunc(sorted.length * p))] as number);
}
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Insights.hours : espaces ordinaires (pas les insécables de Txt). */
function hours(seconds: number): string {
  const m = roundToInt(seconds / 60);
  return `${Math.trunc(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
function shortDuration(seconds: number): string {
  const m = roundToInt(Math.abs(seconds) / 60);
  return m < 60 ? `${m} min` : `${Math.trunc(m / 60)} h` + (m % 60 !== 0 ? ` ${String(m % 60).padStart(2, "0")}` : "");
}
function diffNote(delta: number, unit: string, digits = 0): string {
  const p = 10 ** digits;
  const rounded = roundToInt(delta * p) / p;
  if (rounded === 0) return "comme d'habitude";
  return `${dec(Math.abs(rounded), digits)} ${unit} ${rounded > 0 ? "de plus" : "de moins"} que d'habitude`;
}

/** Charges de séance, puis sommes glissantes sur 7 et 28 jours pour chaque jour du calendrier. */
export class LoadModel {
  readonly dates: string[] = [];
  readonly index = new Map<string, number>();
  readonly week: number[] = [];
  readonly month: number[] = [];
  readonly weekKm: number[] = [];
  readonly weekSessions: number[] = [];
  readonly monthKm: number[] = [];
  readonly monthSessions: number[] = [];
  readonly weekRef: number;
  readonly monthRef: number;
  readonly refs: HrRefs;
  readonly ratio = TRIMP_TO_LOAD;

  constructor(activities: ActivityRow[], daily: DailyRow[], today: string, user: UserHr) {
    this.refs = hrRefs(activities, daily, today, user);
    const byDay = new Map<string, ActivityRow[]>();
    for (const a of activities) byDay.set(dayOf(a), [...(byDay.get(dayOf(a)) ?? []), a]);
    const sessionsByDay = new Map<string, number>();
    for (const [d, list] of byDay) sessionsByDay.set(d, sessionsOfDay(list.filter(isRun)) + list.filter((a) => !isRun(a)).length);
    const perDay = new Map<string, [number, number, number]>();
    for (const a of activities) {
      const load = (trimp(a, this.refs) ?? 0) * this.ratio;
      const [l, km] = perDay.get(dayOf(a)) ?? [0, 0, 0];
      perDay.set(dayOf(a), [l + load, km + (a.distance ?? 0) / 1000, sessionsByDay.get(dayOf(a)) as number]);
    }
    const loads: number[] = [], kms: number[] = [], counts: number[] = [];
    let day: string | null = activities.length > 0 ? dayOf(activities[0] as ActivityRow) : null;
    while (day !== null && daysBetween(day, today) >= 0) {
      const [l, km, n] = perDay.get(day) ?? [0, 0, 0];
      loads.push(l); kms.push(km); counts.push(n);
      this.dates.push(day);
      this.index.set(day, loads.length - 1);
      this.week.push(sum(loads.slice(-WEEK)));
      this.month.push(sum(loads.slice(-MONTH)));
      this.weekKm.push(sum(kms.slice(-WEEK)));
      this.weekSessions.push(sum(counts.slice(-WEEK)));
      this.monthKm.push(sum(kms.slice(-MONTH)));
      this.monthSessions.push(sum(counts.slice(-MONTH)));
      day = addDays(day, 1);
    }
    this.weekRef = percentile(this.week, 0.99);
    this.monthRef = percentile(this.month, 0.99);
  }

  fatigueAt(i: number): number | null {
    const avgWeek = (this.month[i] as number) / 4;
    return avgWeek > this.weekRef * 0.1 ? round1(Math.min(Math.max(((this.week[i] as number) / avgWeek - 0.6) * 10, 0), 10)) : null;
  }
  fatigueOn(date: string): number | null {
    const i = this.index.get(date);
    return i === undefined ? null : this.fatigueAt(i);
  }
  points(): LoadPoint[] {
    return this.dates.map((date, i) => ({
      date, week: on20(this.week[i] as number, this.weekRef), month: on20(this.month[i] as number, this.monthRef), fatigue: this.fatigueAt(i),
      weekKm: this.weekKm[i] as number, weekSessions: this.weekSessions[i] as number, monthKm: this.monthKm[i] as number, monthSessions: this.monthSessions[i] as number,
    }));
  }
}

/** FC de repos : moyenne sur 30 jours. FC max : 99e centile des maxima sur deux ans. Les réglages de l'utilisateur gagnent. */
export function hrRefs(activities: ActivityRow[], daily: DailyRow[], today: string, user: UserHr): HrRefs {
  const since30 = addDays(today, -30);
  const rests = daily.filter((d) => d.date >= since30).map((d) => d.restingHr).filter((x): x is number => x !== null);
  const since730 = addDays(today, -730);
  const maxes = activities.filter((a) => dayOf(a) >= since730).map((a) => a.maxHr).filter((x): x is number => x !== null).sort((a, b) => b - a);
  const rest = user.hrRest > 0 ? user.hrRest : rests.length === 0 ? 50 : roundToInt(mean(rests));
  const max = user.hrMax > 0 ? user.hrMax : (maxes[Math.trunc(maxes.length * 0.01)] ?? 190);
  return { rest, max };
}

/** TRIMP de Banister : de la courbe stockée quand il y en a une, sinon de la FC moyenne. */
export function trimp(a: ActivityRow, refs: HrRefs): number | null {
  if (a.trimp !== null) return a.trimp;
  const hr = a.averageHr;
  const duration = a.duration;
  if (hr === null || duration === null || hr <= 0 || duration <= 0) return null;
  const x = Math.min(Math.max((hr - refs.rest) / (refs.max - refs.rest), 0), 1);
  return (duration / 60) * x * 0.64 * Math.exp(1.92 * x);
}

export function zoneOf(fatigue: number): "fresh" | "optimal" | "high" | "overload" {
  return fatigue < 3 ? "fresh" : fatigue < 7 ? "optimal" : fatigue < 8.5 ? "high" : "overload";
}

export function adviceOf(zone: string | null): string {
  switch (zone) {
    case "fresh": return "Bien reposé : bon moment pour une séance dure ou une course.";
    case "optimal": return "Charge équilibrée : tu progresses sans t'épuiser.";
    case "high": return "Charge élevée : privilégie le footing facile dans les prochains jours.";
    case "overload": return "Surcharge : prévois du repos ou une semaine allégée.";
    default: return "Pas assez d'entraînement récent pour estimer la fatigue.";
  }
}

interface Spec {
  key: string; label: string; weight: number; window: number; minSd: number; sign: number; log: boolean;
  get: (d: DailyRow) => number | null; display: (v: number) => string; note: (v: number, base: number) => string;
}
const SPECS: Spec[] = [
  { key: "sleep", label: "Sommeil", weight: 0.22, window: 30, minSd: 25 * 60, sign: 1, log: false, get: (d) => d.sleepSeconds, display: hours,
    note: (v, base) => (Math.abs(v - base) < 600 ? "comme d'habitude" : `${shortDuration(v - base)} de ${v > base ? "plus" : "moins"} que d'habitude`) },
  { key: "sleepScore", label: "Score de sommeil", weight: 0.08, window: 30, minSd: 4, sign: 1, log: false, get: (d) => d.sleepScore, display: (v) => `${roundToInt(v)}/100`, note: (v, b) => diffNote(v - b, "points") },
  { key: "hrv", label: "VFC de la nuit", weight: 0.27, window: 60, minSd: 0.06, sign: 1, log: true, get: (d) => d.hrvNight, display: (v) => `${roundToInt(v)} ms`, note: (v, b) => diffNote(v - b, "ms") },
  { key: "restingHr", label: "FC au repos", weight: 0.15, window: 30, minSd: 1.5, sign: -1, log: false, get: (d) => d.restingHr, display: (v) => `${roundToInt(v)} bpm`, note: (v, b) => diffNote(v - b, "bpm") },
  { key: "bodyBattery", label: "Body Battery au réveil", weight: 0.08, window: 30, minSd: 6, sign: 1, log: false, get: (d) => d.bodyBatteryHigh, display: (v) => `${roundToInt(v)}/100`, note: (v, b) => diffNote(v - b, "points") },
  { key: "stress", label: "Stress de la journée", weight: 0.05, window: 30, minSd: 3, sign: -1, log: false, get: (d) => d.avgStress, display: (v) => `${roundToInt(v)}/100`, note: (v, b) => diffNote(v - b, "points") },
];

/** Facteurs et note de forme d'un jour. `stressDay` : le jour dont le stress compte (celui de la séance l'après-midi ou le soir). */
export function readinessOn(days: Map<string, DailyRow>, model: LoadModel, date: string, stressDay: string): Readiness | null {
  const factors: Factor[] = [];
  const weights: number[] = [];
  for (const spec of SPECS) {
    const day = spec.key === "stress" ? stressDay : date;
    const row = days.get(day);
    const raw = row ? spec.get(row) : null;
    if (raw === null || raw === undefined) continue;
    const past: number[] = [];
    for (let k = 1; k <= spec.window; k++) {
      const r = days.get(addDays(day, -k));
      const v = r ? spec.get(r) : null;
      if (v !== null && v !== undefined) past.push(v);
    }
    const scale = (v: number) => (spec.log ? Math.log(v) : v);
    let z = 0;
    let baseline: number | null = null;
    if (past.length >= MIN_HISTORY) {
      const scaled = past.map(scale);
      z = (spec.sign * (scale(raw) - mean(scaled))) / Math.max(sd(scaled), spec.minSd);
      baseline = spec.log ? Math.exp(mean(scaled)) : mean(scaled);
    }
    if (spec.key === "sleep" && raw < 6 * 3600) z = Math.min(z, -1.2);
    const zr = roundToInt(z * 100) / 100;
    factors.push({
      key: spec.key, label: spec.label, display: spec.display(raw), note: baseline !== null ? spec.note(raw, baseline) : "pas encore assez d'historique",
      baselineDisplay: baseline !== null ? spec.display(baseline) : null, z: zr, value: raw, baseline, status: zr <= -1 ? "low" : zr >= 0.8 ? "good" : "normal",
    });
    weights.push(spec.weight);
  }
  const fatigue = model.fatigueOn(addDays(date, -1));
  if (fatigue !== null) {
    const z = fatigue > 7 ? -(fatigue - 7) / 1.2 : fatigue < 3 ? 0.5 : 0;
    const note = fatigue > 7 ? "semaine plus chargée que ton mois" : fatigue < 3 ? "semaine légère, tu es frais" : "dans la zone équilibrée";
    const zr = roundToInt(z * 100) / 100;
    factors.push({ key: "fatigue", label: "Fatigue d'entraînement", display: `${dec(fatigue)}/10`, note, baselineDisplay: "3 à 7", z: zr, value: fatigue, baseline: null, status: zr <= -1 ? "low" : zr >= 0.8 ? "good" : "normal" });
    weights.push(FATIGUE_WEIGHT);
  }
  if (!factors.some((f) => f.key === "sleep" || f.key === "hrv")) return null;
  let weighted = 0;
  factors.forEach((f, i) => { weighted += (weights[i] as number) * clamp(f.z, -2.5, 2.0); });
  weighted /= sum(weights);
  const score = roundToInt(clamp(68 + 18 * weighted, 0, 100));
  const label = score >= 82 ? "Au top" : score >= 66 ? "Prêt" : score >= 52 ? "Correct" : score >= 38 ? "Fatigué" : "À ménager";
  return { date, score, label, factors };
}

function latestReadiness(days: Map<string, DailyRow>, model: LoadModel): Readiness | null {
  const dates = [...days.values()].filter((d) => d.sleepSeconds !== null || d.hrvNight !== null).map((d) => d.date);
  if (dates.length === 0) return null;
  const date = dates.reduce((a, b) => (a > b ? a : b));
  return readinessOn(days, model, date, addDays(date, -1));
}

export interface Analysis {
  readiness: Readiness | null;
  load: LoadPoint[];
  /** Moyenne des trois semaines avant les 7 derniers jours, sur 20. */
  previousWeek: number | null;
  refs: HrRefs;
  /** Charge des semaines les plus lourdes (99e centile) : 20 sur l'échelle hebdomadaire. */
  weekRef: number;
  readinessOn: (date: string, stressDay: string) => Readiness | null;
  globalPartsOn: (date: string) => GlobalParts | null;
  globalAfter: (a: ActivityRow) => GlobalParts | null;
  loadOf: (a: ActivityRow) => number | null;
  effortOf: (a: ActivityRow) => number | null;
  pointsOf: (a: ActivityRow) => number | null;
  weekLoadOn: (a: ActivityRow) => number | null;
}

export function analyzeLoad(activities: ActivityRow[], daily: DailyRow[], today: string, user: UserHr = { hrMax: 0, hrRest: 0 }): Analysis {
  const model = new LoadModel(activities, daily, today, user);
  const load = model.points();
  const last = load.length - 1;
  const before: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const w = model.week[last - WEEK * k];
    if (w !== undefined) before.push(on20(w, model.weekRef));
  }
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const readinessAt = (date: string, stressDay: string) => readinessOn(byDate, model, date, stressDay);
  const global = new GlobalLoadModel(activities, daily, model.refs, today);
  const parts = (core: GlobalCore | null, date: string): GlobalParts | null => {
    if (!core) return null;
    const i = model.index.get(date);
    return {
      total: core.note, trainingRatio: core.trainingRatio, volumeRatio: core.volumeRatio, ratio: core.ratio, deficit: core.deficit, unfavorable: core.unfavorable,
      hasNight: core.hasNight, hasWatch: core.hasWatch, weekKm: i !== undefined ? (model.weekKm[i] as number) : 0, weekSessions: i !== undefined ? (model.weekSessions[i] as number) : 0,
      readiness: readinessAt(date, addDays(date, -1))?.score ?? null,
    };
  };
  const loadOf = (a: ActivityRow) => { const t = trimp(a, model.refs); return t === null ? null : t * TRIMP_TO_LOAD; };
  return {
    readiness: latestReadiness(byDate, model), load, previousWeek: before.length === 3 ? mean(before) : null, refs: model.refs, weekRef: model.weekRef,
    readinessOn: readinessAt, globalPartsOn: (d) => parts(global.on(d), d), globalAfter: (a) => parts(global.after(a), dayOf(a)),
    loadOf,
    effortOf: (a) => { const l = loadOf(a); return l === null ? null : roundToInt(100 * (1 - Math.exp(-l / 200))) / 10; },
    pointsOf: (a) => { const l = loadOf(a); return l === null ? null : roundToInt(((20 * l) / model.weekRef) * 10) / 10; },
    weekLoadOn: (a) => load.find((p) => p.date === dayOf(a))?.week ?? null,
  };
}

export { categoryOf };

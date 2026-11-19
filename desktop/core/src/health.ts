// La page santé en cinq indicateurs : portage de HealthSummary.kt. Chaque indicateur répond à une question
// (récupération, sommeil, VFC, condition, fatigue) à partir de ce que mesure la montre.
import { addDays } from "./dates";
import { dec, NBSP, roundToInt } from "./format";
import { adviceOf, zoneOf, type Analysis } from "./insights";
import { isRun, type ActivityRow, type DailyRow } from "./model";

export type MetricStatus = "good" | "normal" | "low";

export interface HealthMetric {
  key: "recovery" | "sleep" | "hrv" | "fitness" | "fatigue";
  label: string;
  value: string;
  unit: string | null;
  status: MetricStatus;
  statusLabel: string;
  delta: string | null;
  sentence: string;
  /** Tendance sur la période choisie, du plus ancien au plus récent. */
  series: [string, number | null][];
  /** Dessiner la tendance à l'envers (allure : plus bas = mieux), pour que « monter » veuille toujours dire « progresser ». */
  inverted: boolean;
  /** Valeur brute placée sur l'échelle de l'explication (score, heures, ms, s/km gagnés, sur 10). */
  numeric: number;
  /** Plage normale personnelle, pour la VFC. */
  band?: [number, number];
}

const EFFICIENCY_HR = 150;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) * (x - m), 0) / (v.length - 1));
};

/** « 7 h 05 » à partir de secondes. */
export function hours(seconds: number): string {
  const m = roundToInt(seconds / 60);
  return `${Math.floor(m / 60)}${NBSP}h${NBSP}${String(m % 60).padStart(2, "0")}`;
}
/** « 45 min » ou « 1 h 10 » pour un écart en secondes. */
export function shortDuration(seconds: number): string {
  const m = roundToInt(Math.abs(seconds) / 60);
  if (m < 60) return `${m}${NBSP}min`;
  return `${Math.floor(m / 60)}${NBSP}h` + (m % 60 !== 0 ? `${NBSP}${String(m % 60).padStart(2, "0")}` : "");
}
const paceOf = (speed: number) => {
  const s = roundToInt(1000 / speed);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
};

// « Sommeil » devient « sommeil » dans une phrase, mais les noms de marque gardent leurs majuscules.
const inSentence = (label: string) => (label.startsWith("Body") || (label[1] !== undefined && label[1] === label[1].toUpperCase() && label[1] !== label[1].toLowerCase()) ? label : label.charAt(0).toLowerCase() + label.slice(1));

function rolling(values: (number | null)[], n: number): (number | null)[] {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v !== null);
    return w.length >= Math.min(3, n) ? mean(w) : null;
  });
}

function recovery(dates: string[], analysis: Analysis): HealthMetric | null {
  const readiness = dates.map((d) => [d, analysis.readinessOn(d, addDays(d, -1))] as const);
  const scores: [string, number | null][] = readiness.map(([d, r]) => [d, r ? r.score : null]);
  const last = [...readiness].reverse().find((x) => x[1] !== null);
  if (!last || !last[1]) return null;
  const today = last[1];
  const lows = today.factors.filter((f) => f.status === "low").sort((a, b) => a.z - b.z);
  const goods = today.factors.filter((f) => f.status === "good").sort((a, b) => b.z - a.z);
  const avg = mean(scores.map((s) => s[1]).filter((v): v is number => v !== null));
  const sentence = lows.length > 0
    ? `Ce qui tire vers le bas : ${lows.slice(0, 2).map((f) => `${inSentence(f.label)} (${f.note})`).join(", ")}.`
    : goods.length > 0 ? `Point fort : ${inSentence((goods[0] as typeof goods[number]).label)} (${(goods[0] as typeof goods[number]).note}).` : "Tous les signaux sont dans ta moyenne.";
  return {
    key: "recovery", label: "Récupération", value: String(today.score), unit: "/ 100", status: today.score >= 66 ? "good" : today.score >= 52 ? "normal" : "low", statusLabel: today.label,
    delta: `moyenne ${roundToInt(avg)} sur la période`, sentence, series: scores, inverted: false, numeric: today.score,
  };
}

function range(map: Map<string, DailyRow>, from: string, to: string, pick: (d: DailyRow) => number | null): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = map.get(d);
    const v = row ? pick(row) : null;
    if (v !== null && v > 0) out.push(v);
  }
  return out;
}

function sleep(dates: string[], today: string, map: Map<string, DailyRow>): HealthMetric | null {
  const nights = (from: string, to: string): [number, number | null][] => {
    const out: [number, number | null][] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = map.get(d);
      if (r && (r.sleepSeconds ?? 0) > 0) out.push([r.sleepSeconds as number, r.sleepScore]);
    }
    return out;
  };
  const week = nights(addDays(today, -6), today);
  const before = nights(addDays(today, -66), addDays(today, -7));
  if (week.length < 3) return null;
  const avg = mean(week.map((n) => n[0]));
  const usual = before.length >= 14 ? mean(before.map((n) => n[0])) : null;
  const scores = week.map((n) => n[1]).filter((v): v is number => v !== null);
  const score = scores.length > 0 ? roundToInt(mean(scores)) : null;
  const gap = usual === null ? 0 : avg - usual;
  // Moins de 7 h en moyenne, c'est court pour un sportif, quelles que soient les habitudes.
  const status: MetricStatus = avg < 6.5 * 3600 || gap < -40 * 60 ? "low" : avg >= 7.5 * 3600 && gap > -10 * 60 ? "good" : "normal";
  const spread = sd(week.map((n) => n[0]));
  return {
    key: "sleep", label: "Sommeil", value: hours(avg), unit: "/ nuit", status, statusLabel: status === "good" ? "Bon" : status === "low" ? "Insuffisant" : "Correct",
    delta: usual === null ? null : Math.abs(gap) < 600 ? "comme d'habitude" : `${shortDuration(gap)} de ${gap > 0 ? "plus" : "moins"} que d'habitude`,
    sentence: `Moyenne des 7 dernières nuits${score !== null ? `, score ${score}/100` : ""}. ${spread > 75 * 60 ? "Nuits très irrégulières d'un jour à l'autre." : "Durée régulière d'une nuit à l'autre."}`,
    series: dates.map((d): [string, number | null] => { const s = map.get(d)?.sleepSeconds ?? null; return [d, s !== null && s > 0 ? roundToInt((s / 3600) * 10) / 10 : null]; }),
    inverted: false, numeric: roundToInt((avg / 3600) * 100) / 100,
  };
}

function hrv(dates: string[], today: string, map: Map<string, DailyRow>): HealthMetric | null {
  const week = range(map, addDays(today, -6), today, (d) => d.hrvNight);
  const base = range(map, addDays(today, -66), addDays(today, -7), (d) => d.hrvNight);
  if (week.length < 3 || base.length < 14) return null;
  // Plage normale sur une échelle logarithmique, comme les études d'entraînement guidé par la VFC.
  const lnBase = base.map(Math.log);
  const m = mean(lnBase);
  const s = Math.max(sd(lnBase), 0.05);
  const avg = Math.exp(mean(week.map(Math.log)));
  const low = Math.exp(m - s);
  const high = Math.exp(m + s);
  const status: MetricStatus = avg < low ? "low" : avg > high ? "good" : "normal";
  const rhrWeek = range(map, addDays(today, -6), today, (d) => d.restingHr);
  const rhrBase = range(map, addDays(today, -66), addDays(today, -7), (d) => d.restingHr);
  const rhrGap = rhrWeek.length > 0 && rhrBase.length > 0 ? mean(rhrWeek) - mean(rhrBase) : null;
  const rhrText = rhrGap === null ? "" : Math.abs(rhrGap) < 1.5 ? ` FC au repos stable (${roundToInt(mean(rhrWeek))} bpm).` : ` FC au repos ${rhrGap > 0 ? "en hausse" : "en baisse"} de ${dec(Math.abs(rhrGap), 0)} bpm (${roundToInt(mean(rhrWeek))} bpm).`;
  const smooth = rolling(dates.map((d) => map.get(d)?.hrvNight ?? null), 7);
  return {
    key: "hrv", label: "VFC", value: String(roundToInt(avg)), unit: "ms", status, statusLabel: status === "low" ? "Sous ta norme" : status === "good" ? "Au-dessus" : "Équilibrée",
    delta: `ta plage normale : ${roundToInt(low)} à ${roundToInt(high)} ms`,
    sentence: `Moyenne des 7 dernières nuits.${status === "low" ? " Une VFC sous ta plage signale une fatigue ou un stress : allège l'intensité quelques jours." : ""}${rhrText}`,
    series: dates.map((d, i): [string, number | null] => { const v = smooth[i] ?? null; return [d, v === null ? null : roundToInt(v)]; }),
    inverted: false, numeric: roundToInt(avg), band: [roundToInt(low), roundToInt(high)],
  };
}

function fitness(dates: string[], today: string, activities: ActivityRow[]): HealthMetric | null {
  // Footings réguliers seulement : pas de fractionné, de 30 min à 2 h, FC moyenne de 130 à 165, vitesse ramenée à 150 bpm.
  const since = addDays(today, -400);
  const points = activities
    .filter((a) => isRun(a) && a.intervalTitle === null && a.startLocal.slice(0, 10) >= since && (a.averageHr ?? 0) >= 130 && (a.averageHr ?? 0) <= 165 && (a.duration ?? 0) >= 1800 && (a.duration ?? 0) <= 7200 && (a.averageSpeed ?? 0) > 0)
    .map((a): [string, number] => [a.startLocal.slice(0, 10), ((a.averageSpeed as number) * EFFICIENCY_HR) / (a.averageHr as number)]);
  const between = (from: string, to: string) => points.filter((p) => p[0] >= from && p[0] <= to).map((p) => p[1]);
  const recent = between(addDays(today, -27), today);
  const before = between(addDays(today, -83), addDays(today, -28));
  if (recent.length < 3) return null;
  const now = median(recent);
  // Secondes par km gagnées à 150 bpm par rapport aux deux mois d'avant (positif = plus vite maintenant).
  const gap = before.length >= 3 ? roundToInt(1000 / median(before) - 1000 / now) : null;
  const status: MetricStatus = gap === null || Math.abs(gap) < 3 ? "normal" : gap > 0 ? "good" : "low";
  // Mini-courbe : médiane des 28 jours finissant à chaque date (assez lisse pour lire une tendance).
  const series = dates.map((d): [string, number | null] => { const w = between(addDays(d, -27), d); return [d, w.length >= 3 ? roundToInt((1000 / median(w)) * 10) / 10 : null]; });
  return {
    key: "fitness", label: "Condition", value: paceOf(now).replace("/km", ""), unit: `/km à ${EFFICIENCY_HR} bpm`, status, statusLabel: status === "good" ? "En progrès" : status === "low" ? "En baisse" : "Stable",
    delta: gap === null ? null : gap === 0 ? "comme les 2 mois d'avant" : `${Math.abs(gap)} s/km ${gap > 0 ? "plus vite" : "plus lent"} que les 2 mois d'avant`,
    sentence: `Ton allure à ${EFFICIENCY_HR} bpm sur tes footings réguliers des 4 dernières semaines : plus elle baisse, plus tu es en forme.`,
    series, inverted: true, numeric: gap ?? 0,
  };
}

function fatigue(days: number, analysis: Analysis): HealthMetric | null {
  const today = analysis.load[analysis.load.length - 1];
  const f = today?.fatigue ?? null;
  if (f === null) return null;
  const zone = zoneOf(f);
  return {
    key: "fatigue", label: "Fatigue", value: dec(f), unit: "/ 10", status: zone === "high" || zone === "overload" ? "low" : "good",
    statusLabel: zone === "fresh" ? "Frais" : zone === "optimal" ? "Équilibrée" : zone === "high" ? "Élevée" : "Surcharge",
    delta: "3 à 7 = équilibré", sentence: adviceOf(zone), series: analysis.load.slice(-days).map((p): [string, number | null] => [p.date, p.fatigue]), inverted: false, numeric: f,
  };
}

/** Les indicateurs de santé sur `days` jours finissant à `today` (AAAA-MM-JJ). Un indicateur sans assez de données est simplement absent. */
export function healthSummary(days: number, activities: ActivityRow[], daily: DailyRow[], analysis: Analysis, today: string): HealthMetric[] {
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const map = new Map(daily.map((d) => [d.date, d]));
  return [recovery(dates, analysis), sleep(dates, today, map), hrv(dates, today, map), fitness(dates, today, activities), fatigue(days, analysis)].filter((m): m is HealthMetric => m !== null);
}

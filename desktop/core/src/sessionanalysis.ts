// Analyse automatique d'une séance de fractionné : portage de SessionAnalysis.kt (lui-même issu de session-analysis.ts).
//
// 1. Performance : chaque répétition est comparée aux répétitions passées de durée voisine (±35 %, 12 derniers mois). L'indice de séance est l'écart d'allure
//    pondéré par la durée, en % ; la FC est comparée de la même façon.
// 2. Déroulé : fade (dernier tiers contre premier), régularité, récupération de la FC.
// 3. Pourquoi : le contexte du jour (sommeil, VFC, FC de repos, Body Battery, stress, fatigue, repos depuis la dernière séance dure, chaleur). Les corrélations
//    personnelles sont mesurées sur toutes les séances ; quand l'historique ne dit rien de net, on prend les effets de la littérature, en prudence.
import { addDays, daysBetween } from "./dates";
import { dec, NBSP, roundToInt } from "./format";
import { analyze as analyzeLaps, type IntervalAnalysis, type Lap, type RepGroup } from "./intervals";
import type { Analysis, Factor } from "./insights";
import { isRun, type ActivityRow, type Sample } from "./model";
import type { RefsNum } from "./refs";

export interface RepVerdict { group: number; rep: number; speed: number; reference: number | null; deltaSecPerKm: number | null; hr: number | null }
export interface Contribution { key: string; label: string; detail: string; effectPct: number; effectSecPerKm: number; source: string }
export interface Correlation { key: string; label: string; n: number; rho: number; p: number; strength: string; splitEffectPct: number; text: string }
export interface HrRecovery { avg: number; first: number; last: number }

export interface SessionAnalysis {
  verdict: string;
  verdictLabel: string;
  paceIndex: number | null;
  paceDeltaSecPerKm: number | null;
  hrDelta: number | null;
  fadePct: number | null;
  hrRecovery: HrRecovery | null;
  reps: RepVerdict[];
  factors: Factor[];
  contributions: Contribution[];
  correlations: Correlation[];
  /** Nombre de séances de fractionné derrière les corrélations personnelles. */
  sampleSize: number;
  paragraphs: string[];
  /** La version d'une ligne pour l'accueil. */
  summary: string;
  /** « Note de la séance » sur 10. */
  score: number | null;
  scoreLevel: number | null;
  scoreRegularity: number | null;
  paceVariationPct: number | null;
  scoreIntensity: number | null;
  scoreVolume: number | null;
  intensityHrPct: number | null;
  intensityPaceRatio: number | null;
  effortMinutes: number | null;
  firstThirdSpeed: number | null;
  lastThirdSpeed: number | null;
  mainRepSeconds: number | null;
  mainGroupIndex: number | null;
}

export interface SessionNote { remark: string | null; summary: string | null }

// ---------- Aides de texte (Txt.kt) ----------

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;
const ordinal = (n: number) => (n === 1 ? "1re" : `${n}e`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const join = (p: string[]) => (p.length <= 1 ? p.join("") : `${p.slice(0, -1).join(", ")} et ${p[p.length - 1]}`);
const hoursText = (seconds: number) => { const m = roundToInt(seconds / 60); return `${Math.floor(m / 60)}${NBSP}h${NBSP}${String(m % 60).padStart(2, "0")}`; };
const paceText = (speed: number) => { const s = roundToInt(1000 / speed); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`; };
const paceSpaced = (speed: number) => { const s = Math.round(1000 / speed); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} / km`; };

/** Une formulation parmi plusieurs, toujours la même pour une graine donnée (id de séance, date). */
export function pick<T>(seed: number, variants: T[]): T {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  const i = Math.floor((x - Math.floor(x)) * variants.length);
  return variants[Math.min(Math.max(i, 0), variants.length - 1)] as T;
}
export function seedOf(value: string | number): number {
  let h = 0;
  for (const c of String(value)) h = (Math.imul(h, 31) + (c.codePointAt(0) as number)) | 0;
  return h === -2147483648 ? h : Math.abs(h);
}

// ---------- Statistiques ----------

const mean = (v: number[]) => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);
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
const round1 = (v: number) => roundToInt(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const speedOf = (l: Lap) => (l.distance ?? 0) / (l.duration ?? 1);

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const result = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as readonly [number, number])[0] === (order[i] as readonly [number, number])[0]) j++;
    for (let k = i; k <= j; k++) result[(order[k] as readonly [number, number])[1]] = (i + j) / 2;
    i = j + 1;
  }
  return result;
}

function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    dx += ((xs[i] as number) - mx) ** 2;
    dy += ((ys[i] as number) - my) ** 2;
  }
  return dx !== 0 && dy !== 0 ? num / Math.sqrt(dx * dy) : 0;
}

/** Loi normale centrée réduite (approximation d'Abramowitz et Stegun). */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.sqrt(2)));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const pValue = (rho: number, n: number) => (n > 3 ? 2 * (1 - phi(Math.abs(Math.atanh(clamp(rho, -0.999, 0.999))) * Math.sqrt(n - 3))) : 1);

function slopeOf(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den !== 0 ? xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0) / den : 0;
}

// ---------- Historique ----------

const SIMILAR_DURATION = 1.35;
// Les blocs plus longs sont des échauffements ou des retours au calme pris pour des répétitions par la détection, pas des efforts à noter.
const MAX_REP_SECONDS = 15 * 60;
const HISTORY_DAYS = 365;
// Les séances récentes comptent plus dans la référence : le poids est divisé par deux tous les 60 jours.
const HALF_LIFE = 60;
const MIN_SESSIONS = 10;

interface RepRecord { sessionId: number; label: string; date: string; duration: number; speed: number; hr: number | null }
interface SessionRecord {
  id: number; date: string; startLocal: string; title: string; analysis: IntervalAnalysis; reps: RepVerdict[]; paceIndex: number | null; hrDelta: number | null;
  avgSpeed: number; context: Record<string, number>; factors: Factor[];
}
interface CtxSpec {
  key: string; label: string;
  /** Sens attendu par la physiologie : +1 = plus c'est mieux, -1 = plus c'est pire, 0 = aucun a priori. */
  sign: number;
  format: (v: number) => string; below: (v: number) => string; above: (v: number) => string;
  /** Effet de la littérature, en % d'allure, pour une valeur v quand la valeur habituelle est t. */
  prior: (v: number, t: number) => number;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${dec(Math.abs(v))}`;

const CTX: CtxSpec[] = [
  { key: "sleep", label: "Sommeil", sign: 1, format: (v) => hoursText(v * 3600), below: (v) => `tu dors moins de ${hoursText(v * 3600)}`, above: (v) => `tu dors plus de ${hoursText(v * 3600)}`,
    prior: (v, t) => (v < t ? Math.max(-1 * (t - v) - (v < 6 ? 0.8 : 0), -4) : Math.min(0.4 * (v - t), 0.8)) },
  { key: "sleepScore", label: "Score de sommeil", sign: 1, format: (v) => `${roundToInt(v)}/100`, below: (v) => `ton score de sommeil est sous ${roundToInt(v)}`, above: (v) => `ton score de sommeil dépasse ${roundToInt(v)}`,
    prior: (v, t) => (v < t - 10 ? -0.04 * (t - 10 - v) : 0) },
  { key: "hrv", label: "VFC de la nuit", sign: 1, format: (v) => `${signed(v)} écart-type`, below: () => "ta VFC de la nuit est dans le bas de ta fourchette", above: () => "ta VFC de la nuit est dans le haut de ta fourchette",
    prior: (v) => (v < -1 ? Math.max(0.9 * (v + 0.5), -3) : v > 1 ? 0.4 : 0) },
  { key: "restingHr", label: "FC au repos", sign: -1, format: (v) => `${signed(v)} bpm`, below: () => "ta FC au repos est à son niveau habituel", above: (v) => `ta FC au repos dépasse ta moyenne de ${dec(Math.max(v, 1), 0)} bpm ou plus`,
    prior: (v) => (v > 2 ? -0.3 * (v - 2) : 0) },
  { key: "bodyBattery", label: "Body Battery au réveil", sign: 1, format: (v) => `${roundToInt(v)}/100`, below: (v) => `ta Body Battery au réveil est sous ${roundToInt(v)}`, above: (v) => `ta Body Battery au réveil dépasse ${roundToInt(v)}`,
    prior: (v, t) => (v < t - 15 ? -0.5 : 0) },
  { key: "stress", label: "Stress", sign: -1, format: (v) => `${roundToInt(v)}/100`, below: (v) => `ton stress moyen reste sous ${roundToInt(v)}`, above: (v) => `ton stress moyen dépasse ${roundToInt(v)}`,
    prior: (v, t) => (v > t + 8 ? -0.4 : 0) },
  { key: "fatigue", label: "Fatigue d'entraînement", sign: -1, format: (v) => `${dec(v)}/10`, below: (v) => `ta fatigue est sous ${dec(v)}/10`, above: (v) => `ta fatigue dépasse ${dec(v)}/10`,
    prior: (v) => (v > 7 ? -0.6 * (v - 7) : 0) },
  { key: "rest", label: "Repos depuis la dernière séance dure", sign: 1, format: (v) => plural(roundToInt(v), "jour"), below: (v) => `ta dernière séance dure date de ${plural(roundToInt(v), "jour")} ou moins`, above: (v) => `ta dernière séance dure date de plus de ${plural(roundToInt(v), "jour")}`,
    prior: (v) => (v <= 1 ? -1.5 : 0) },
  { key: "heat", label: "Température (montre)", sign: -1, format: (v) => `${roundToInt(v)} °C`, below: (v) => `la montre affiche moins de ${roundToInt(v)} °C`, above: (v) => `la montre affiche plus de ${roundToInt(v)} °C`,
    // La montre lit quelques degrés au-dessus de l'air (chaleur du corps) : seul l'écart à la valeur habituelle compte.
    prior: (v, t) => (v > Math.max(t, 15) + 2 ? -0.3 * (v - Math.max(t, 15) - 2) : 0) },
  { key: "hour", label: "Heure de la séance", sign: 0, format: (v) => `${roundToInt(v)} h`, below: (v) => `tu cours avant ${roundToInt(v)} h`, above: (v) => `tu cours après ${roundToInt(v)} h`, prior: () => 0 },
];

const VERDICT_LABELS: Record<string, string> = {
  excellent: "Excellente séance", good: "Séance réussie", standard: "Dans tes standards", below: "Un ton en dessous", hard: "Séance difficile", first: "Nouvelle référence", controlled: "Séance contrôlée",
};
const VERDICT_ORDER = ["hard", "below", "standard", "good", "excellent"];

interface Fade { pct: number; worst: number; best: number; collapseAt: number | null; firstSpeed: number; lastSpeed: number }

const mainGroup = (a: IntervalAnalysis): RepGroup => {
  const efforts = a.groups.filter((g) => g.avgDuration <= MAX_REP_SECONDS);
  return (efforts.length > 0 ? efforts : a.groups).reduce((best, g) => (g.reps.length * g.avgDuration > best.reps.length * best.avgDuration ? g : best));
};
const groupName = (g: RepGroup) => `${g.reps.length > 1 ? `${g.reps.length} × ` : ""}${g.label}`;
const adjustedIndex = (paceIndex: number, hrDelta: number | null) => paceIndex - 0.12 * Math.max(Math.min(hrDelta ?? 0, 8), -8);

/** Allure du dernier tiers des répétitions contre le premier, en % (négatif = a ralenti). */
function fadeOf(g: RepGroup): Fade | null {
  if (g.reps.length < 3) return null;
  const speeds = g.reps.map((r) => speedOf(r.lap));
  const third = Math.max(1, Math.floor(speeds.length / 3));
  const start = mean(speeds.slice(0, third));
  const pct = (mean(speeds.slice(-third)) / start - 1) * 100;
  // Première répétition à partir de laquelle toutes restent nettement plus lentes que le début.
  let collapseAt: number | null = null;
  for (let i = third; i < speeds.length; i++) {
    if (speeds.slice(i).every((v) => v < start * 0.98)) { collapseAt = i + 1; break; }
  }
  return { pct: round1(pct), worst: speeds.indexOf(Math.min(...speeds)) + 1, best: speeds.indexOf(Math.max(...speeds)) + 1, collapseAt, firstSpeed: start, lastSpeed: mean(speeds.slice(-third)) };
}

/** Baisse de la FC pendant la première minute de chaque récupération (bpm). */
function hrRecoveryOf(a: IntervalAnalysis, allLaps: Lap[], samples: Sample[]): HrRecovery | null {
  const points = samples.filter((s) => s.t !== null && (s.hr ?? 0) > 0) as (Sample & { t: number; hr: number })[];
  if (points.length < 20) return null;
  const starts: number[] = [];
  let t = 0;
  for (const l of allLaps) { starts.push(t); t += l.duration ?? 0; }
  const hrAt = (time: number) => points.reduce((best, p) => (Math.abs(p.t - time) < Math.abs(best.t - time) ? p : best)).hr;
  const drops: number[] = [];
  a.laps.forEach((info, i) => {
    const next = a.laps[i + 1];
    if (info.role !== "WORK" || next?.role !== "RECOVERY" || (next.lap.duration ?? 0) < 50) return;
    const idx = allLaps.indexOf(next.lap);
    if (idx < 0) return;
    const end = starts[idx] as number;
    const peak = points.filter((p) => p.t >= end - 15 && p.t <= end).reduce((m, p) => Math.max(m, p.hr), 0);
    const after = hrAt(end + Math.min(60, (next.lap.duration as number) - 2));
    if (peak > 0 && peak - after > 0) drops.push(peak - after);
  });
  if (drops.length < 3) return null;
  const half = Math.floor(drops.length / 2);
  return { avg: roundToInt(mean(drops)), first: roundToInt(mean(drops.slice(0, half))), last: roundToInt(mean(drops.slice(drops.length - half))) };
}

interface ScoreParts { score: number; level: number | null; regularity: number | null; cv: number | null; intensity: number; volume: number; hrPct: number | null; paceRatio: number; effortSeconds: number }

export class SessionHistory {
  private cache: SessionRecord[] | null = null;
  private readonly notes = new Map<number, SessionNote>();

  /** `lapsById` : les tours de chaque séance de fractionné (la base les range à part des séances). */
  constructor(private readonly activities: ActivityRow[], private readonly lapsById: Map<number, Lap[]>, private readonly analysis: Analysis, private readonly refs: RefsNum) {}

  private get sessions(): SessionRecord[] { return (this.cache ??= this.build()); }

  /** La dernière séance de fractionné, pour l'accueil, ou null. */
  latest(): ActivityRow | null {
    const last = this.sessions[this.sessions.length - 1];
    return last ? this.activities.find((a) => a.id === last.id) ?? null : null;
  }

  /** La note d'une séance de fractionné pour le bilan de la semaine ; null pour toute autre séance. */
  noteOf(id: number): SessionNote | null {
    const known = this.notes.get(id);
    if (known) return known;
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return null;
    const a = this.analyze(id, [], s.analysis.laps.map((l) => l.lap));
    if (!a) return null;
    const note = { remark: sessionRemark(a), summary: a.summary };
    this.notes.set(id, note);
    return note;
  }

  /** La vitesse habituelle pour une répétition : d'abord le même format (« 1000 m », « 30 s »), puis des répétitions de durée voisine, puis une courbe allure/durée. */
  private referenceFor(label: string, duration: number, date: string, past: RepRecord[]): { speed: number; hr: number | null } | null {
    const from = addDays(date, -HISTORY_DAYS);
    const recent = past.filter((r) => r.date >= from);
    const usable = (reps: RepRecord[]) => {
      if (reps.length < 3 || new Set(reps.map((r) => r.sessionId)).size < 2) return null;
      const typical = median(reps.map((r) => r.speed));
      const kept = reps.filter((r) => r.speed >= typical * 0.8);
      const hrs = kept.filter((r) => r.hr !== null).map((r) => [r.hr as number, r.date] as [number, string]);
      return { speed: weightedMedian(kept.map((r) => [r.speed, r.date] as [number, string]), date), hr: hrs.length >= 3 ? weightedMedian(hrs, date) : null };
    };
    const same = usable(recent.filter((r) => r.label === label));
    if (same) return same;
    const near = usable(recent.filter((r) => r.duration <= duration * SIMILAR_DURATION && r.duration >= duration / SIMILAR_DURATION));
    if (near) return near;
    if (recent.length < 12) return null;
    // Courbe de type Riegel : log(vitesse) = a + b log(durée)
    const xs = recent.map((r) => Math.log(r.duration));
    const ys = recent.map((r) => Math.log(r.speed));
    const mx = mean(xs), my = mean(ys);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
    const b = xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0) / den;
    return { speed: Math.exp(my + b * (Math.log(duration) - mx)), hr: null };
  }

  private rateSession(a: IntervalAnalysis, date: string, past: RepRecord[]) {
    const reps: RepVerdict[] = [];
    let weighted = 0, covered = 0, total = 0;
    const hrGaps: number[] = [];
    a.groups.forEach((g, gi) => {
      g.reps.forEach((r, ri) => {
        const duration = r.lap.duration as number;
        const speed = speedOf(r.lap);
        const ref = g.avgDuration <= MAX_REP_SECONDS ? this.referenceFor(g.label, duration, date, past) : null;
        if (g.avgDuration <= MAX_REP_SECONDS) total += duration;
        if (ref) {
          weighted += (speed / ref.speed - 1) * duration;
          covered += duration;
          // Sous 90 s la FC n'a pas le temps de monter : sa moyenne dit plus sur la récupération que sur l'effort.
          if (ref.hr !== null && (r.lap.averageHr ?? 0) > 0 && duration >= 90) hrGaps.push((r.lap.averageHr as number) - ref.hr);
        }
        reps.push({ group: gi, rep: ri + 1, speed, reference: ref?.speed ?? null, deltaSecPerKm: ref ? roundToInt(1000 / speed - 1000 / ref.speed) : null, hr: r.lap.averageHr });
      });
    });
    // Pas assez de répétitions comparables : pas de verdict plutôt qu'un verdict trompeur.
    const paceIndex = covered > 0 && covered >= total * 0.5 ? roundToInt((weighted / covered) * 1000) / 10 : null;
    const hrDelta = hrGaps.length >= 2 ? roundToInt(mean(hrGaps) * 10) / 10 : null;
    return { reps, paceIndex, hrDelta };
  }

  private build(): SessionRecord[] {
    // Jours des séances dures (effort ≥ 6 sur 10 : fractionné, tempo ou sortie longue)
    const hardDays = this.activities.filter((a) => (this.analysis.effortOf(a) ?? 0) >= 6).map((a) => a.startLocal.slice(0, 10));
    const runs = this.activities.filter((a) => a.intervalTitle !== null && isRun(a)).sort((a, b) => (a.startLocal < b.startLocal ? -1 : a.startLocal > b.startLocal ? 1 : 0));
    const past: RepRecord[] = [];
    const out: SessionRecord[] = [];
    for (const a of runs) {
      const laps = this.lapsById.get(a.id);
      const ia = laps ? analyzeLaps(laps) : null;
      if (!ia) continue;
      const date = a.startLocal.slice(0, 10);
      const hour = Number(a.startLocal.slice(11, 13));
      const rating = this.rateSession(ia, date, past);
      const factors = this.analysis.readinessOn(date, hour >= 14 ? date : addDays(date, -1))?.factors ?? [];
      const factor = (key: string) => factors.find((f) => f.key === key);
      const previousHard = hardDays.filter((d) => d < date).pop();
      const context: Record<string, number> = {};
      const sleep = factor("sleep"); if (sleep) context.sleep = sleep.value / 3600;
      const sleepScore = factor("sleepScore"); if (sleepScore) context.sleepScore = sleepScore.value;
      const hrv = factor("hrv"); if (hrv) context.hrv = hrv.z;
      const rhr = factor("restingHr"); if (rhr && rhr.baseline !== null) context.restingHr = rhr.value - rhr.baseline;
      const bb = factor("bodyBattery"); if (bb) context.bodyBattery = bb.value;
      const stress = factor("stress"); if (stress) context.stress = stress.value;
      const fatigue = factor("fatigue"); if (fatigue) context.fatigue = fatigue.value;
      if (previousHard !== undefined) context.rest = daysBetween(previousHard, date);
      if (a.minTemperature !== undefined && a.minTemperature !== null) context.heat = a.minTemperature;
      context.hour = hour;
      const efforts = ia.groups.filter((g) => g.avgDuration <= MAX_REP_SECONDS);
      const work = (efforts.length > 0 ? efforts : ia.groups).flatMap((g) => g.reps);
      out.push({
        id: a.id, date, startLocal: a.startLocal, title: ia.title, analysis: ia, reps: rating.reps, paceIndex: rating.paceIndex, hrDelta: rating.hrDelta,
        avgSpeed: work.reduce((s, r) => s + (r.lap.distance as number), 0) / work.reduce((s, r) => s + (r.lap.duration as number), 0), context, factors,
      });
      for (const g of ia.groups) for (const r of g.reps) past.push({ sessionId: a.id, label: g.label, date, duration: r.lap.duration as number, speed: speedOf(r.lap), hr: r.lap.averageHr });
    }
    return out;
  }

  private correlate(spec: CtxSpec, list: SessionRecord[], refSpeed: number): Correlation | null {
    const pairs = list.filter((s) => s.paceIndex !== null && s.context[spec.key] !== undefined).map((s) => [s.context[spec.key] as number, s.paceIndex as number] as const);
    if (pairs.length < MIN_SESSIONS) return null;
    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);
    const rho = pearson(ranks(xs), ranks(ys));
    const p = pValue(rho, pairs.length);
    const split = median(xs);
    const low = pairs.filter((q) => q[0] <= split).map((q) => q[1]);
    const high = pairs.filter((q) => q[0] > split).map((q) => q[1]);
    if (low.length === 0 || high.length === 0) return null;
    const diff = mean(high) - mean(low);
    // La physiologie dit dans quel sens ça doit aller : un lien en sens inverse est très probablement un hasard.
    const plausible = spec.sign === 0 || Math.sign(diff) === spec.sign || p < 0.05;
    const strength = plausible && Math.abs(rho) >= 0.3 && p < 0.1 ? "nette" : plausible && Math.abs(rho) >= 0.18 && p < 0.3 ? "légère" : "aucune";
    const worse = diff > 0 ? spec.below(split) : spec.above(split);
    const pct = Math.abs(diff);
    const secs = roundToInt((1000 / refSpeed) * (pct / 100));
    const text = strength === "aucune"
      ? `${spec.label} : pas de lien visible avec tes allures sur ${plural(pairs.length, "séance")}.`
      : `Quand ${worse}, tes répétitions sont en moyenne ${secs !== 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} min au km plus lentes` : "à peine plus lentes"}, sur ${plural(pairs.length, "séance")}.`;
    return { key: spec.key, label: spec.label, n: pairs.length, rho: roundToInt(rho * 100) / 100, p: roundToInt(p * 1000) / 1000, strength, splitEffectPct: -roundToInt(pct * 10) / 10, text };
  }

  private factorDetail(key: string, value: number, typical: number, factors: Factor[]): string {
    const f = factors.find((x) => x.key === key);
    if (f) return f.baselineDisplay !== null ? `${f.display} (${f.note})` : f.display;
    const spec = CTX.find((c) => c.key === key) as CtxSpec;
    return `${spec.format(value)} (d'habitude ${spec.format(typical)})`;
  }

  /** L'effet estimé de chaque valeur inhabituelle du contexte sur l'allure de cette séance. */
  private contributions(s: SessionRecord, list: SessionRecord[], correlations: Correlation[]): Contribution[] {
    const result: Contribution[] = [];
    for (const spec of CTX) {
      const value = s.context[spec.key];
      if (value === undefined || spec.key === "hour") continue;
      // Une valeur proche de l'habituelle n'explique rien, quelle que soit la pente.
      const factor = s.factors.find((f) => f.key === spec.key);
      if (factor && factor.baseline !== null && Math.abs(factor.z) < 0.5) continue;
      const values = list.map((x) => x.context[spec.key]).filter((v): v is number => v !== undefined);
      const typical = values.length >= 5 ? median(values) : spec.key === "hrv" || spec.key === "restingHr" ? 0 : value;
      const corr = correlations.find((c) => c.key === spec.key);
      let effect = spec.prior(value, typical);
      let source = "études";
      if (corr && corr.strength !== "aucune") {
        // Pente personnelle, en % d'allure par unité, ramenée vers zéro quand le lien est faible.
        const pairs = list.filter((x) => x.paceIndex !== null && x.context[spec.key] !== undefined);
        const slope = slopeOf(pairs.map((x) => x.context[spec.key] as number), pairs.map((x) => x.paceIndex as number));
        const spread = sd(values) || 1;
        const deviation = clamp(value - typical, -2.5 * spread, 2.5 * spread);
        effect = slope * deviation * (corr.strength === "nette" ? 1 : 0.6);
        source = "perso";
      }
      if (Math.abs(effect) < 0.4) continue;
      effect = round1(effect);
      result.push({ key: spec.key, label: spec.label, detail: this.factorDetail(spec.key, value, typical, s.factors), effectPct: effect, effectSecPerKm: roundToInt((1000 / s.avgSpeed) * (-effect / 100)), source });
    }
    return result.sort((a, b) => Math.abs(b.effectPct) - Math.abs(a.effectPct));
  }

  /** Ce que l'athlète pouvait tenir au mieux pendant `seconds`, d'après ses références (record 5 km et VMA). */
  private maxSpeedFor(seconds: number): number {
    const { rec5, vma } = this.refs;
    if (rec5 <= 0 || vma <= 0) return Infinity;
    const v5 = 5000 / rec5;
    const vmaMs = vma / 3.6;
    return seconds >= 360 ? v5 * (seconds / rec5) ** -0.06 : vmaMs * (1 + 0.12 * (1 - Math.max(seconds, 30) / 360));
  }

  /**
   * « Note de la séance » sur 10, quatre parties qui doivent toutes être bonnes (elle reste exigeante) : intensité (40 %), volume (15 %), niveau (25 %), régularité (20 %).
   * Échauffements et retours au calme (blocs de plus de 25 minutes) ne comptent jamais. Une partie inconnue est écartée et les autres pèsent plus.
   */
  private scoreOf(session: SessionRecord, z: number | null, fadePct: number | null): ScoreParts | null {
    const groups = session.analysis.groups;
    const efforts = session.reps.filter((r) => { const d = groups[r.group]?.avgDuration; return d !== undefined && d >= 15 && d <= 25 * 60; });
    if (efforts.length === 0) return null;
    const lapOf = (r: RepVerdict) => (groups[r.group] as RepGroup).reps[r.rep - 1]?.lap as Lap;
    const durationOf = (r: RepVerdict) => lapOf(r).duration ?? 0;
    const totalSeconds = efforts.reduce((s, r) => s + durationOf(r), 0);
    if (totalSeconds <= 0) return null;
    const refs = this.analysis.refs;
    const reserve = Math.max(refs.max - refs.rest, 1);
    // La FC d'une répétition : moitié de sa moyenne (elle retarde sur l'effort) et moitié de son pic.
    const repHr = (r: RepVerdict): number | null => {
      const lap = lapOf(r);
      const avg = (lap.averageHr ?? 0) > 0 ? (lap.averageHr as number) : null;
      if (avg === null) return null;
      return (avg + ((lap.maxHr ?? 0) >= avg ? (lap.maxHr as number) : avg)) / 2;
    };
    type Part = [number, number, number];
    const hrParts: Part[] = efforts.flatMap((r): Part[] => { const hr = repHr(r); if (hr === null) return []; const pct = (hr - refs.rest) / reserve; return [[pct, clamp(((pct - 0.6) / 0.35) * 10, 0, 10), durationOf(r)]]; });
    const paceParts: Part[] = efforts.map((r) => { const ratio = r.speed / this.maxSpeedFor(durationOf(r)); return [ratio, clamp(((ratio - 0.75) / 0.25) * 10, 0, 10), durationOf(r)]; });
    const weighted = (parts: Part[], p: (x: Part) => number) => parts.reduce((s, x) => s + p(x) * x[2], 0) / parts.reduce((s, x) => s + x[2], 0);
    const hrScore = hrParts.length > 0 ? weighted(hrParts, (x) => x[1]) : null;
    const paceScore = weighted(paceParts, (x) => x[1]);
    const intensity = mean([hrScore, paceScore].filter((v): v is number => v !== null));
    const volume = clamp((totalSeconds / 60 / 25) * 10, 0, 10);
    // Les répétitions courtes varient naturellement : la variation est divisée par 2 au plus sous deux minutes.
    const byGroup = new Map<number, RepVerdict[]>();
    for (const r of efforts) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    const cvs = [...byGroup.values()].filter((reps) => reps.length >= 2).map((reps) => {
      const cv = (sd(reps.map((r) => r.speed)) / mean(reps.map((r) => r.speed))) * 100;
      const seconds = mean(reps.map(durationOf));
      return [cv / Math.sqrt(clamp(120 / seconds, 1, 4)), seconds * reps.length] as const;
    });
    const cv = cvs.length === 0 ? null : cvs.reduce((s, c) => s + c[0] * c[1], 0) / cvs.reduce((s, c) => s + c[1], 0);
    const fadePenalty = fadePct !== null && fadePct <= -8 ? 2 : fadePct !== null && fadePct <= -4 ? 1 : 0;
    const regularity = cv === null ? null : clamp(10 - (cv - 1) * 1.5 - fadePenalty, 0, 10);
    const level = z === null ? null : clamp(6 + 1.5 * z, 0, 10);
    const weights = ([[intensity, 0.4], [volume, 0.15], [level, 0.25], [regularity, 0.2]] as [number | null, number][]).filter((w): w is [number, number] => w[0] !== null);
    const score = weights.reduce((s, w) => s + w[0] * w[1], 0) / weights.reduce((s, w) => s + w[1], 0);
    return {
      score: round1(score), level: level === null ? null : round1(level), regularity: regularity === null ? null : round1(regularity), cv: cv === null ? null : round1(cv),
      intensity: round1(intensity), volume: round1(volume), hrPct: hrParts.length > 0 ? round1(weighted(hrParts, (x) => x[0]) * 100) : null, paceRatio: round1(weighted(paceParts, (x) => x[0]) * 100), effortSeconds: totalSeconds,
    };
  }

  /** L'analyse complète d'une séance de fractionné, ou null pour un footing. `samples` et `laps` sont ceux de la séance. */
  analyze(activityId: number, samples: Sample[], laps: Lap[]): SessionAnalysis | null {
    const session = this.sessions.find((s) => s.id === activityId);
    if (!session) return null;
    const others = this.sessions.filter((s) => s !== session);
    const refSpeed = median(this.sessions.map((s) => s.avgSpeed));
    const correlations = CTX.map((c) => this.correlate(c, others, refSpeed)).filter((c): c is Correlation => c !== null).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
    const seed = seedOf(activityId);
    const contribs = this.contributions(session, others, correlations);
    const fade = fadeOf(mainGroup(session.analysis));
    const indices = this.sessions.filter((s) => s.paceIndex !== null).map((s) => adjustedIndex(s.paceIndex as number, s.hrDelta));
    const center = indices.length >= 8 ? median(indices) : 0;
    const spread = indices.length >= 8 ? Math.max(1.4826 * median(indices.map((i) => Math.abs(i - center))), 1.5) : 3;
    const verdict = verdictOf(session.paceIndex, session.hrDelta, fade?.pct ?? null, center, spread);
    const parts = this.scoreOf(session, session.paceIndex !== null ? (adjustedIndex(session.paceIndex, session.hrDelta) - center) / spread : null, fade?.pct ?? null);
    // Détectée à nouveau sur les tours passés : les départs des tours se retrouvent par identité d'objet.
    const own = analyzeLaps(laps);
    const recovery = own ? hrRecoveryOf(own, laps, samples) : null;
    const main = mainGroup(session.analysis);
    const paragraphs = [describePerformance(seed, verdict, session.analysis, session), describeCourse(seed, session.analysis, recovery), describeWhy(seed, verdict, session, contribs, correlations) || null, advice(seed, verdict, contribs, fade)]
      .filter((p): p is string => p !== null);
    return {
      verdict, verdictLabel: VERDICT_LABELS[verdict] as string, paceIndex: session.paceIndex, paceDeltaSecPerKm: session.paceIndex !== null ? roundToInt((1000 / session.avgSpeed) * (-session.paceIndex / 100)) : null,
      hrDelta: session.hrDelta, fadePct: fade?.pct ?? null, hrRecovery: recovery, reps: session.reps, factors: session.factors, contributions: contribs, correlations,
      sampleSize: others.filter((s) => s.paceIndex !== null).length, paragraphs, summary: paragraphs[0] as string, score: parts?.score ?? null, scoreLevel: parts?.level ?? null,
      scoreRegularity: parts?.regularity ?? null, paceVariationPct: parts?.cv ?? null, scoreIntensity: parts?.intensity ?? null, scoreVolume: parts?.volume ?? null, intensityHrPct: parts?.hrPct ?? null,
      intensityPaceRatio: parts?.paceRatio ?? null, effortMinutes: parts ? parts.effortSeconds / 60 : null, firstThirdSpeed: fade?.firstSpeed ?? null, lastThirdSpeed: fade?.lastSpeed ?? null,
      mainRepSeconds: main.avgDuration, mainGroupIndex: session.analysis.groups.indexOf(main),
    };
  }
}

function weightedMedian(items: [number, string][], date: string): number {
  const weighted = items.map(([value, d]) => [value, 0.5 ** (daysBetween(d, date) / HALF_LIFE)] as const).sort((a, b) => a[0] - b[0]);
  const total = weighted.reduce((s, w) => s + w[1], 0);
  let acc = 0;
  for (const [value, w] of weighted) { acc += w; if (acc >= total / 2) return value; }
  return (weighted[weighted.length - 1] as readonly [number, number])[0];
}

/** Les niveaux sont relatifs à la dispersion propre de l'athlète (écart-type robuste de tous les indices de séance). */
function verdictOf(paceIndex: number | null, hrDelta: number | null, fadePct: number | null, center: number, spread: number): string {
  if (paceIndex === null) return "first";
  const z = (adjustedIndex(paceIndex, hrDelta) - center) / spread;
  // Plus lent mais avec une FC nettement plus basse : une séance plus facile par choix, pas un échec.
  if (z < -0.5 && hrDelta !== null && hrDelta <= -4) return "controlled";
  let level = z >= 1.1 ? 4 : z >= 0.4 ? 3 : z > -0.6 ? 2 : z > -1.3 ? 1 : 0;
  // Une série qui s'écroule à la fin n'est pas une séance au top, quelle que soit la moyenne.
  if (fadePct !== null && fadePct <= -4 && level > 2) level -= 1;
  return VERDICT_ORDER[level] as string;
}

function describePerformance(seed: number, verdict: string, ia: IntervalAnalysis, s: SessionRecord): string {
  const g = mainGroup(ia);
  const name = groupName(g);
  const others = ia.groups.filter((x) => x !== g);
  const gap = s.paceIndex === null ? 0 : roundToInt((1000 / s.avgSpeed) * (Math.abs(s.paceIndex) / 100));
  const at = `à ${paceText(g.avgSpeed)} de moyenne`;
  const hr = s.hrDelta;
  const hrClause = hr === null ? ""
    : Math.abs(hr) < 2 ? pick(seed + 1, [", avec une FC comparable", ", pour une FC habituelle", ", cardio au même niveau que d'habitude"])
    : hr < 0 ? pick(seed + 1, [`, avec ${dec(-hr, 0)} bpm de moins que d'habitude`, ` et une FC plus basse de ${dec(-hr, 0)} bpm`])
    : pick(seed + 1, [`, mais avec ${dec(hr, 0)} bpm de plus que d'habitude`, `, au prix d'une FC plus haute de ${dec(hr, 0)} bpm`]);
  const extra = others.length > 0 ? ` (plus ${join(others.map(groupName))})` : "";
  if (verdict === "first") return `${capitalize(name)}${extra} ${at}. Pas encore assez de répétitions de cette durée dans ton historique pour comparer : cette séance servira de référence.`;
  const index = s.paceIndex as number;
  const faster = index >= 0;
  const vs = gap === 0 ? "exactement à ton allure habituelle sur ce type de répétition" : `${gap} s/km ${faster ? "plus vite" : "plus lent"} que d'habitude sur ce format`;
  switch (verdict) {
    case "excellent": return pick(seed, [`Très grosse séance. Tes ${name}${extra} sont passés ${at}, ${vs}${hrClause}.`, `${capitalize(name)}${extra} ${at} : c'est ${vs}${hrClause}.${index >= 6 ? " Une de tes meilleures sur ce format." : ""}`]);
    case "good": return pick(seed, [`Bonne séance : ${name}${extra} ${at}, ${vs}${hrClause}.`, `Tes ${name}${extra} sont passés ${at}, soit ${vs}${hrClause}.`]);
    case "standard": return pick(seed, [`${capitalize(name)}${extra} ${at}, ${vs}${hrClause}. Une séance dans tes standards.`, `Séance conforme à ce que tu fais d'habitude : ${name}${extra} ${at}, ${vs}${hrClause}.`]);
    case "below": return pick(seed, [`Séance un peu en dessous : ${name}${extra} ${at}, ${vs}${hrClause}.`, `Tes ${name}${extra} sont passés ${at}, ${vs}${hrClause}. Pas une mauvaise séance, mais pas ton meilleur jour.`]);
    case "controlled": return `${capitalize(name)}${extra} ${at}, ${vs}, mais ta FC aussi était plus basse (${dec(-(s.hrDelta ?? 0), 0)} bpm de moins). Plutôt une séance gérée qu'un jour sans : l'intensité était simplement plus basse.`;
    default: return pick(seed, [`Séance compliquée : ${name}${extra} ${at}, ${vs}${hrClause}.`, `Jour sans sur ces ${name}${extra} : ${at}, ${vs}${hrClause}.`]);
  }
}

const gapText = (f: Fade) => { const seconds = Math.round(Math.abs(1000 / f.lastSpeed - 1000 / f.firstSpeed)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min au km`; };

function describeCourse(seed: number, ia: IntervalAnalysis, recovery: HrRecovery | null): string | null {
  const g = mainGroup(ia);
  const fade = fadeOf(g);
  const parts: string[] = [];
  if (fade) {
    const speeds = g.reps.map((r) => speedOf(r.lap));
    const spread = roundToInt(1000 / Math.min(...speeds) - 1000 / Math.max(...speeds));
    if (fade.pct <= -3) {
      parts.push(fade.collapseAt !== null
        ? pick(seed + 2, [`Ça s'est gâté à partir de la ${ordinal(fade.collapseAt)} répétition : la fin de série est ${gapText(fade)} plus lente que le début.`, `Le début était bon, mais à partir de la ${ordinal(fade.collapseAt)} tu n'as plus retrouvé ton allure (${gapText(fade)} plus lent sur la fin).`])
        : `Tu as perdu ${gapText(fade)} entre le début et la fin de la série.`);
    } else if (fade.pct >= 1.5) {
      parts.push(pick(seed + 2, [`Tu as fini plus vite que tu n'as commencé (${gapText(fade)} plus rapide sur le dernier tiers), signe qu'il restait de la marge.`, `Belle gestion : le dernier tiers de la série est ${gapText(fade)} plus rapide que le premier.`]));
    } else if (spread <= 4) {
      parts.push(pick(seed + 2, [`Régularité de métronome : ${spread} s/km seulement entre la plus rapide et la plus lente.`, `Série très régulière, ${spread} s/km d'écart en tout.`]));
    }
  }
  if (recovery) {
    // Ne vaut une phrase que si elle se dégrade : la moyenne est déjà donnée en chiffre.
    if (recovery.last - recovery.first <= -6) parts.push(`Pendant les récups, ta FC redescendait de ${recovery.first} bpm en une minute au début, puis seulement de ${recovery.last} bpm sur la fin : la fatigue s'installait.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function phraseOf(c: Contribution, s: SessionRecord): string {
  const f = s.factors.find((x) => x.key === c.key);
  const v = s.context[c.key] as number;
  switch (c.key) {
    case "sleep": return f ? `une nuit de ${f.display}, ${f.note}` : "une nuit courte";
    case "sleepScore": return f ? `un score de sommeil de ${f.display}` : "un sommeil de mauvaise qualité";
    case "hrv": return f ? `une VFC à ${f.display}, ${f.note}${f.z <= -1 ? " (sous ta fourchette normale)" : f.z >= 1 ? " (dans le haut de ta fourchette)" : ""}` : "une VFC basse";
    case "restingHr": return f ? `une FC au repos à ${f.display}, ${f.note}` : "une FC au repos élevée";
    case "bodyBattery": return f ? `une Body Battery à ${f.display} au réveil` : "une Body Battery basse";
    case "stress": return !f ? (c.effectPct < 0 ? "une journée stressante" : "une journée calme") : c.effectPct < 0 ? `une journée stressante (${f.display}, ${f.note})` : `une journée calme (stress à ${f.display})`;
    case "fatigue": return `une fatigue d'entraînement à ${dec(v)}/10`;
    case "rest": return v <= 1 ? (v === 0 ? "une autre séance dure le même jour" : "une séance dure la veille") : `${plural(roundToInt(v), "jour")} de récup depuis la dernière séance dure`;
    case "heat": return `de la chaleur (${roundToInt(v)} °C à la montre)`;
    default: return c.label.toLowerCase();
  }
}

function describeWhy(seed: number, verdict: string, s: SessionRecord, contribs: Contribution[], correlations: Correlation[]): string {
  const negatives = contribs.filter((c) => c.effectPct < 0);
  const positives = contribs.filter((c) => c.effectPct > 0);
  const personal = (key: string) => correlations.find((c) => c.key === key && c.strength !== "aucune");
  const poor = verdict === "below" || verdict === "hard";
  const great = verdict === "excellent" || verdict === "good";
  const sentences: string[] = [];
  const quantified = (list: Contribution[]) => {
    const secs = list.reduce((a, c) => a + Math.abs(c.effectSecPerKm), 0);
    if (secs < 1) return "";
    return list.length > 1 ? ` ${pick(seed + 5, ["À eux deux, ils pèsent", "Ensemble, ça représente"])} environ ${secs} s/km.` : ` Ça pèse à peu près ${secs} s/km.`;
  };
  if (poor && negatives.length > 0) {
    const top = negatives.slice(0, 2);
    const reasons = join(top.map((c) => phraseOf(c, s)));
    sentences.push(pick(seed + 4, [`Le contexte explique une bonne partie de l'écart : ${reasons}.`, `Ce n'est pas un hasard : ${reasons}.`, `Il y a une raison : ${reasons}.`]) + quantified(top));
    const link = top.map((c) => personal(c.key)).find((x) => x !== undefined);
    if (link) sentences.push(`Ce n'est pas qu'une impression : ${lowerFirst(link.text)}`);
    else if (top.some((c) => c.key === "sleep")) sentences.push("Les études sur le manque de sommeil vont dans le même sens : ce sont justement les efforts intenses et répétés qui en souffrent le plus, surtout en fin de journée.");
  } else if (poor) {
    sentences.push(pick(seed + 4, [
      "Pourtant rien d'anormal côté récupération : sommeil, VFC et FC au repos étaient dans ta norme. Ça arrive, une séance moyenne isolée ne veut rien dire.",
      "Côté récupération, rien ne l'explique : nuit, VFC et FC au repos étaient normales. Si ça se répète, c'est plutôt la charge des dernières semaines qu'il faudra regarder.",
    ]));
  } else if (great && negatives.length > 0) {
    const reasons = join(negatives.slice(0, 2).map((c) => phraseOf(c, s)));
    sentences.push(pick(seed + 4, [`Et ça malgré ${reasons}.`, `D'autant plus solide que le contexte n'aidait pas : ${reasons}.`]));
  } else if (great && positives.length > 0) {
    const reasons = join(positives.slice(0, 2).map((c) => phraseOf(c, s)));
    sentences.push(pick(seed + 4, [`Le terrain était favorable : ${reasons}.`, `Tu arrivais bien récupéré, avec ${reasons}.`]));
    const link = positives.map((c) => personal(c.key)).find((x) => x !== undefined);
    if (link) sentences.push(`Ça colle avec ton historique : ${lowerFirst(link.text)}`);
  } else if (negatives.length > 0) {
    sentences.push(`À noter : ${join(negatives.slice(0, 2).map((c) => phraseOf(c, s)))}, sans que ça t'empêche de tenir tes allures.`);
  }
  return sentences.join(" ");
}

function advice(seed: number, verdict: string, contribs: Contribution[], fade: Fade | null): string | null {
  const top = contribs.find((c) => c.effectPct < 0);
  if ((verdict === "below" || verdict === "hard") && top) {
    switch (top.key) {
      case "sleep": case "sleepScore": return pick(seed + 6, ["Après une nuit aussi courte, mieux vaut garder la séance mais enlever une ou deux répétitions, ou la décaler d'un jour.", "Une piste simple : les veilles de fractionné, viser au moins ta durée de sommeil habituelle."]);
      case "hrv": case "restingHr": return "Quand la VFC sort de ta fourchette basse ou que la FC au repos grimpe, une séance plus courte ou un footing passe souvent mieux que le plan prévu.";
      case "rest": return "Laisse au moins un jour facile entre deux séances dures : c'est souvent le plus rentable.";
      case "fatigue": return "La charge des derniers jours était élevée : une semaine un peu plus légère te rendra tes allures.";
      case "heat": return "Par forte chaleur, raisonne à l'effort (FC) plutôt qu'à l'allure, ou cours plus tôt.";
      default: return null;
    }
  }
  if (fade && fade.pct <= -4 && verdict !== "hard") return "Pour la prochaine, pars 2 ou 3 s/km plus prudemment sur les premières : la série entière sera plus rapide.";
  return null;
}

// ---------- La remarque courte (SessionRemark, Coaching.kt) ----------

const REMARK_CAUSE: Record<string, string> = {
  sleep: "une nuit courte", sleepScore: "une mauvaise nuit", hrv: "une VFC basse", restingHr: "une FC de repos élevée", bodyBattery: "une Body Battery basse", stress: "une journée stressante",
  fatigue: "de la fatigue accumulée", rest: "peu de récupération depuis la dernière séance dure", heat: "la chaleur",
};

/** La courte remarque qui remplace l'ancienne note d'une séance de fractionné : seulement ce qui n'allait pas, avec sa cause probable. Null quand il n'y a rien à dire. */
export function sessionRemark(sa: SessionAnalysis | null): string | null {
  if (!sa) return null;
  const why = sa.contributions.filter((c) => c.effectPct < 0).map((c) => REMARK_CAUSE[c.key]).find((x) => x !== undefined);
  const sentences: string[] = [];
  // Sa répétition la plus rapide et la plus lente du groupe principal : elles peuvent s'écarter de 6 % de l'allure sur les longues, 12 % sous 2 minutes.
  const main = sa.mainGroupIndex !== null ? sa.reps.filter((r) => r.group === sa.mainGroupIndex) : [];
  const usable = main.length >= 3 ? main : null;
  const fastest = usable ? Math.max(...usable.map((r) => r.speed)) : null;
  const slowest = usable ? Math.min(...usable.map((r) => r.speed)) : null;
  const spreadSeconds = fastest !== null && slowest !== null ? Math.round(1000 / slowest - 1000 / fastest) : 0;
  const tolerance = (sa.mainRepSeconds ?? 0) >= 120 ? 0.06 : 0.12;
  const irregular = fastest !== null && slowest !== null && spreadSeconds >= 10 && spreadSeconds / (1000 / ((fastest + slowest) / 2)) >= tolerance;
  const range = fastest !== null && slowest !== null ? `de ${paceSpaced(fastest)} à ${paceSpaced(slowest)}` : "";
  const fade = sa.fadePct;
  if (fade !== null && fade <= -4) {
    const first = sa.firstThirdSpeed, last = sa.lastThirdSpeed;
    sentences.push("Tu as trop ralenti à la fin" + (first !== null && last !== null ? ` (${paceSpaced(first)} au début, ${paceSpaced(last)} sur la fin)` : "") + (irregular ? `, répétitions ${range}.` : "."));
  } else if (irregular) sentences.push(`Répétitions irrégulières : ${range}.`);
  const hr = sa.hrDelta;
  if (hr !== null && hr >= 5) sentences.push(`FC plus haute que d'habitude (+${roundToInt(hr)} bpm)` + (why ? `, sûrement à cause de ${why}` : "") + ".");
  else if ((sa.paceDeltaSecPerKm ?? 0) >= 3 && (sa.verdict === "below" || sa.verdict === "hard")) sentences.push(`Allures plus lentes que d'habitude (+${sa.paceDeltaSecPerKm} s/km)` + (why ? `, sûrement à cause de ${why}` : "") + ".");
  if (sa.hrRecovery && sa.hrRecovery.last - sa.hrRecovery.first <= -6 && sentences.length < 2) sentences.push("Ta FC redescendait moins bien pendant les récups en fin de séance.");
  return sentences.length > 0 ? sentences.join(" ") : null;
}

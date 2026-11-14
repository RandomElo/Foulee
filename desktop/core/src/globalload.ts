// Charge globale sur 20 : portage de GlobalLoad.kt (voir son commentaire pour le modèle).
import { addDays, daysBetween } from "./dates";
import { dayOf, isRun, type ActivityRow, type DailyRow } from "./model";
import { trimp, type HrRefs } from "./insights";

export interface GlobalCore {
  note: number; trainingRatio: number; volumeRatio: number | null; ratio: number; deficit: number;
  unfavorable: [string, number][]; hasNight: boolean; hasWatch: boolean;
}

const F_SHORT = Math.exp(-1 / 7);
const F_LONG = Math.exp(-1 / 42);
const SCALE_SHORT = 7 * (1 - F_SHORT);
const SCALE_LONG = 7 * (1 - F_LONG);
const MIN_DAYS = 28;
const MIN_LONG_KM = 5.0;
const POINTS: [number, number][] = [[0, 0], [0.6, 5], [0.85, 9], [1.05, 13], [1.4, 17], [1.8, 20]];
const round1 = (v: number) => Math.round(v * 10) / 10;
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const average = (v: number[]) => sum(v) / v.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Échelle fixe : linéaire entre les points, 20 en haut. */
export function scale(rs: number): number {
  if (rs <= 0) return 0;
  for (let i = 0; i < POINTS.length - 1; i++) {
    const [p0, p1] = POINTS[i] as [number, number];
    const [q0, q1] = POINTS[i + 1] as [number, number];
    if (rs <= q0) return p1 + ((q1 - p1) * (rs - p0)) / (q0 - p0);
  }
  return 20;
}

export class GlobalLoadModel {
  private readonly byDay = new Map<string, ActivityRow[]>();
  private readonly first: string | null;
  private readonly days: number;
  private readonly dailyBy: Map<string, DailyRow>;
  private readonly trimpDay: number[];
  private readonly kmDay: number[];
  private readonly shortW: number[];
  private readonly longW: number[];
  private readonly shortK: number[];
  private readonly longK: number[];
  private readonly trimps = new Map<number, number>();
  private readonly cache = new Map<string, GlobalCore | null>();

  constructor(activities: ActivityRow[], daily: DailyRow[], refs: HrRefs, today: string) {
    for (const a of activities.filter((x) => x.id > 0)) this.byDay.set(dayOf(a), [...(this.byDay.get(dayOf(a)) ?? []), a]);
    const keys = [...this.byDay.keys()];
    this.first = keys.length > 0 ? keys.reduce((a, b) => (a < b ? a : b)) : null;
    this.days = this.first !== null ? daysBetween(this.first, today) + 1 : 0;
    this.dailyBy = new Map(daily.map((d) => [d.date, d]));
    const n = this.days;
    this.trimpDay = new Array<number>(n).fill(0);
    this.kmDay = new Array<number>(n).fill(0);
    this.shortW = new Array<number>(n).fill(0);
    this.longW = new Array<number>(n).fill(0);
    this.shortK = new Array<number>(n).fill(0);
    this.longK = new Array<number>(n).fill(0);
    if (this.first !== null) {
      for (const [date, list] of this.byDay) {
        const i = daysBetween(this.first, date);
        if (i < 0 || i >= n) continue;
        for (const a of list) {
          const t = trimp(a, refs) ?? 0;
          this.trimps.set(a.id, t);
          this.trimpDay[i] = (this.trimpDay[i] as number) + t;
          if (isRun(a)) this.kmDay[i] = (this.kmDay[i] as number) + (a.distance ?? 0) / 1000;
        }
      }
      for (let i = 0; i < n; i++) {
        this.shortW[i] = (this.trimpDay[i] as number) + (i > 0 ? (this.shortW[i - 1] as number) : 0) * F_SHORT;
        this.longW[i] = (this.trimpDay[i] as number) + (i > 0 ? (this.longW[i - 1] as number) : 0) * F_LONG;
        this.shortK[i] = (this.kmDay[i] as number) + (i > 0 ? (this.shortK[i - 1] as number) : 0) * F_SHORT;
        this.longK[i] = (this.kmDay[i] as number) + (i > 0 ? (this.longK[i - 1] as number) : 0) * F_LONG;
      }
    }
  }

  /** La valeur d'une journée entière (toutes ses séances). */
  on(date: string): GlobalCore | null {
    if (!this.cache.has(date)) this.cache.set(date, this.compute(date, null));
    return this.cache.get(date) as GlobalCore | null;
  }

  /** La valeur juste après une séance : celles du jour jusqu'à celle-ci incluse. */
  after(a: ActivityRow): GlobalCore | null {
    return this.compute(dayOf(a), a);
  }

  private compute(date: string, upTo: ActivityRow | null): GlobalCore | null {
    if (this.first === null) return null;
    const i = daysBetween(this.first, date);
    if (i < MIN_DAYS || i >= this.days) return null;
    let sw = this.shortW[i] as number, lw = this.longW[i] as number, sk = this.shortK[i] as number, lk = this.longK[i] as number;
    if (upTo !== null) {
      const sameDay = (this.byDay.get(date) ?? []).filter((x) => x.startLocal <= upTo.startLocal);
      const w = sum(sameDay.map((x) => this.trimps.get(x.id) ?? 0));
      const k = sum(sameDay.filter(isRun).map((x) => (x.distance ?? 0) / 1000));
      sw = w + (this.shortW[i - 1] as number) * F_SHORT; lw = w + (this.longW[i - 1] as number) * F_LONG;
      sk = k + (this.shortK[i - 1] as number) * F_SHORT; lk = k + (this.longK[i - 1] as number) * F_LONG;
    }
    const a = sw * SCALE_SHORT, c = lw * SCALE_LONG;
    const ak = sk * SCALE_SHORT, ck = lk * SCALE_LONG;
    if (c <= 0) return null;
    const training = a / c;
    const volume = ck >= MIN_LONG_KM && ak > 0 ? ak / ck : null;
    const ratio = volume !== null ? training ** 0.6 * volume ** 0.4 : training;

    const dv = this.unfavourable(date, 1.0, 0.04, (d) => (d.hrvNight !== null && d.hrvNight > 0 ? Math.log(d.hrvNight) : null));
    const df = this.unfavourable(date, -1.0, 0.8, (d) => d.restingHr);
    const ds = this.unfavourable(date, 1.0, 0.25, (d) => (d.sleepSeconds !== null ? d.sleepSeconds / 3600 : null));
    const deficit = clamp((0.4 * dv + 0.35 * df + 0.25 * ds) / 1.5, 0, 1);
    const rs = ratio * (1 + 0.2 * deficit * clamp((ratio - 1) / 0.2, 0, 1));
    const row = this.dailyBy.get(date);
    const night = row !== undefined && (row.sleepSeconds !== null || row.hrvNight !== null);
    const watch = row !== undefined && (row.sleepSeconds !== null || row.hrvNight !== null || row.restingHr !== null || row.steps !== null || row.avgStress !== null);
    const unfavorable = ([["VFC", dv], ["FC de repos", df], ["Sommeil", ds]] as [string, number][]).filter((p) => p[1] > 0);
    return { note: round1(scale(rs)), trainingRatio: training, volumeRatio: volume, ratio, deficit, unfavorable, hasNight: night, hasWatch: watch };
  }

  /**
   * Défavorable ou non : les 7 dernières nuits contre les jours 8 à 63 d'avant, en écarts-types au-delà d'un demi, de 0 à 2.
   * `sign` : +1 quand plus bas est pire (VFC, sommeil), -1 quand plus haut est pire (FC de repos).
   */
  private unfavourable(date: string, sign: number, floor: number, signal: (d: DailyRow) => number | null): number {
    const rolling = (end: string): number | null => {
      const values: number[] = [];
      for (let k = 0; k <= 6; k++) {
        const r = this.dailyBy.get(addDays(end, -k));
        const v = r ? signal(r) : null;
        if (v !== null) values.push(v);
      }
      return values.length >= 4 ? average(values) : null;
    };
    const now = rolling(date);
    if (now === null) return 0;
    const base: number[] = [];
    for (let k = 8; k <= 63; k++) {
      const v = rolling(addDays(date, -k));
      if (v !== null) base.push(v);
    }
    if (base.length < 20) return 0;
    const m = average(base);
    const sd = Math.max(Math.sqrt(sum(base.map((x) => (x - m) * (x - m))) / base.length), floor);
    return clamp((sign * (m - now)) / sd - 0.5, 0, 2);
  }
}

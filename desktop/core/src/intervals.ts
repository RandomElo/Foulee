// Détection des séances de fractionné : portage fidèle de android/.../Intervals.kt (analyze et layout).
// Toute modification se fait des deux côtés, avec les mêmes cas (voir scripts/verifier-tout.sh).
// Pas encore porté : repairLaps, notes (ils demandent les échantillons GPS/allure).
import { NBSP, dec, roundToInt } from "./format";

export interface Lap {
  distance: number | null;
  duration: number | null;
  averageSpeed: number | null;
  averageHr: number | null;
  maxHr: number | null;
  elevationGain: number | null;
  intensityType: string | null;
  stepIndex: number | null;
}

export type LapRole = "WARMUP" | "WORK" | "RECOVERY" | "COOLDOWN" | "OTHER";

export interface LapInfo {
  lap: Lap;
  role: LapRole;
  group: number | null;
  rep: number | null;
  kind: number | null;
}

export interface RecoveryKind {
  label: string;
  measured: boolean;
  laps: LapInfo[];
}

export interface Recovery {
  duration: number;
  distance: number;
  speed: number;
  label: string;
  measured: boolean | null;
}

export interface RepGroup {
  label: string;
  timeBased: boolean;
  reps: LapInfo[];
  avgSpeed: number;
  avgDuration: number;
  avgDistance: number;
  avgHr: number | null;
  bestSpeed: number;
  worstSpeed: number;
  recovery: Recovery | null;
}

export interface IntervalAnalysis {
  title: string;
  structured: boolean;
  groups: RepGroup[];
  laps: LapInfo[];
  recoveryKinds: RecoveryKind[];
  sequence: number[];
}

export interface Layout {
  efforts: string;
  entries: [string, string][];
  block: boolean;
}

const MIN_GAP = 1.12;
const SAME_DISTANCE = 0.15;
const TIMED_TOLERANCE = 1.5;
const LONG_TIMED_TOLERANCE = 3.0;
export const APP_SPLIT = -7;
export const MAX_RECOVERIES_IN_TITLE = 4;

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const mean = (v: number[]) => sum(v) / v.length;
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
function cv(v: number[]): number {
  const m = mean(v);
  return m !== 0 ? Math.sqrt(mean(v.map((x) => (x - m) * (x - m)))) / m : 0;
}
const distinct = (v: number[]) => [...new Set(v)];
const d0 = (x: number | null) => x ?? 0;
const nn = (x: number | null): number => {
  if (x === null) throw new Error("valeur absente");
  return x;
};

const roundStep = (d: number) => (d >= 2950 ? 500 : d >= 950 ? 100 : d >= 150 ? 50 : 10);
const roundDistance = (d: number) => roundToInt(d / roundStep(d)) * roundStep(d);

function nominalDistance(d: number): string {
  const r = roundDistance(d);
  return r >= 3000 ? `${dec(r / 1000, 1)}${NBSP}km` : `${roundToInt(r)}${NBSP}m`;
}

const onRoundDistance = (d: number) => Math.abs(d - roundDistance(d)) / roundDistance(d) <= 0.025;

function nominalDuration(s: number): string {
  const rounded = roundToInt(s / 5) * 5;
  const m = Math.trunc(rounded / 60);
  const sec = rounded % 60;
  if (m === 0) return `${sec}${NBSP}s`;
  return sec !== 0 ? `${m}${NBSP}min${NBSP}${String(sec).padStart(2, "0")}` : `${m}${NBSP}min`;
}

const isTiny = (l: Lap) => d0(l.distance) < 30 && d0(l.duration) < 15;
const speedOf = (l: Lap) => (d0(l.duration) > 0 ? d0(l.distance) / (l.duration as number) : 0);

function structuredRoles(laps: Lap[]): LapRole[] | null {
  if (laps.every((l) => l.intensityType === null)) return null;
  const roles: LapRole[] = laps.map((l) => {
    if (isTiny(l)) return "OTHER";
    switch (l.intensityType) {
      case "WARMUP":
        return "WARMUP";
      case "COOLDOWN":
        return "COOLDOWN";
      case "REST":
      case "RECOVERY":
        return "RECOVERY";
      case "ACTIVE":
      case "INTERVAL":
        return "WORK";
      default:
        return "OTHER";
    }
  });
  if (roles.filter((r) => r === "WORK").length < 2) return null;
  const first = roles.indexOf("WORK");
  const last = roles.lastIndexOf("WORK");
  return roles.map((r, i) => (i > first && i < last && (r === "COOLDOWN" || r === "WARMUP") ? "RECOVERY" : r));
}

interface Cut {
  roles: LapRole[];
  gap: number;
  alternations: number;
  fast: number;
}

function inferredRoles(laps: Lap[]): LapRole[] | null {
  const candidates = laps.filter((l) => !isTiny(l) && speedOf(l) > 0);
  const speeds = distinct(candidates.map(speedOf)).sort((a, b) => b - a);
  let widestGap = 0;
  let widestThreshold = 0;
  for (let i = 0; i < speeds.length - 1; i++) {
    const gap = (speeds[i] as number) / (speeds[i + 1] as number);
    if (gap > widestGap) {
      widestGap = gap;
      widestThreshold = ((speeds[i] as number) + (speeds[i + 1] as number)) / 2;
    }
  }
  const cutAt = (threshold: number, gap: number): Cut | null => {
    const fast = candidates.filter((l) => speedOf(l) > threshold).length;
    if (gap < MIN_GAP || fast < 2 || fast === candidates.length) return null;
    const roles: LapRole[] = laps.map((l) => (isTiny(l) ? "OTHER" : speedOf(l) > threshold ? "WORK" : "RECOVERY"));
    const real = roles.filter((r) => r !== "OTHER");
    let alternations = 0;
    for (let i = 0; i < real.length - 1; i++) if (real[i] === "WORK" && real[i + 1] === "RECOVERY") alternations++;
    return { roles, gap, alternations, fast };
  };
  const widest = cutAt(widestThreshold, widestGap);
  if (!widest) return null;
  let chosen: Cut;
  if (widest.alternations >= 0.6 * widest.fast || widest.alternations >= widest.fast - 1) {
    chosen = widest;
  } else {
    // maxWithOrNull : garde le premier des ex æquo
    let best: Cut | null = null;
    for (let i = 0; i < speeds.length - 1; i++) {
      const c = cutAt(((speeds[i] as number) + (speeds[i + 1] as number)) / 2, (speeds[i] as number) / (speeds[i + 1] as number));
      if (!c) continue;
      if (best === null || best.alternations < c.alternations || (best.alternations === c.alternations && best.gap < c.gap)) best = c;
    }
    if (!best) return null;
    chosen = best;
  }
  if (candidates.length - chosen.fast < (chosen.fast - 1) / 2.0) return null;
  const roles = trimBeforeLongLap(chosen.roles, laps);
  const first = roles.indexOf("WORK");
  const last = roles.lastIndexOf("WORK");
  return roles.map((r, i) => (r !== "RECOVERY" ? r : i < first ? "WARMUP" : i > last ? "COOLDOWN" : "RECOVERY"));
}

function hasRealRecovery(infos: LapInfo[]): boolean {
  const work = infos.filter((i) => i.role === "WORK").map((i) => speedOf(i.lap));
  if (work.length === 0) return false;
  const pace = median(work);
  return infos.some((i) => i.role === "RECOVERY" && d0(i.lap.duration) >= 45 && speedOf(i.lap) <= 0.75 * pace);
}

function trimBeforeLongLap(roles: LapRole[], laps: Lap[]): LapRole[] {
  const long = roles.map((_, i) => i).filter((i) => roles[i] === "RECOVERY" && d0((laps[i] as Lap).duration) >= 600);
  const firstWork = roles.indexOf("WORK");
  const lastWork = roles.lastIndexOf("WORK");
  const i = long.find((k) => k >= firstWork && k <= lastWork);
  if (i === undefined) return roles;
  let before = 0;
  for (let k = 0; k < i; k++) if (roles[k] === "WORK") before++;
  let after = 0;
  for (let k = i + 1; k < roles.length; k++) if (roles[k] === "WORK") after++;
  if (before >= 1 && before <= 3 && after >= 3 * before) {
    return roles.map((r, k) => (k < i && r === "WORK" ? "OTHER" : k <= i ? (r === "RECOVERY" ? "WARMUP" : r) : r));
  }
  if (after >= 1 && after <= 3 && before >= 3 * after) {
    return roles.map((r, k) => (k > i && r === "WORK" ? "OTHER" : k >= i && r === "RECOVERY" ? "COOLDOWN" : r));
  }
  return roles;
}

const nearestMultiple = (v: number, step: number) => roundToInt(v / step) * step;

function timedKey(l: Lap): number | null {
  if (l.duration === null) return null;
  const d = l.duration;
  const keys = d < 90 ? [nearestMultiple(d, 15), nearestMultiple(d, 10)] : [nearestMultiple(d, 15)];
  const tol = d >= 300 ? LONG_TIMED_TOLERANCE : TIMED_TOLERANCE;
  const found = keys.find((k) => d >= 15 && Math.abs(d - k) <= tol);
  return found === undefined ? null : found;
}

function isTimedSession(work: LapInfo[]): boolean {
  if (work.length >= 2 && isLongRoundTime(work.map((w) => d0(w.lap.duration)), work.map((w) => d0(w.lap.distance)))) return true;
  if (work.length < 4 || work.filter((w) => timedKey(w.lap) !== null).length < work.length * 0.9) return false;
  const clusters = new Map<number, LapInfo[]>();
  for (const w of work) {
    const k = timedKey(w.lap);
    if (k === null) continue;
    const c = clusters.get(k);
    if (c) c.push(w);
    else clusters.set(k, [w]);
  }
  const wander = (c: LapInfo[]): boolean => {
    const dist = c.map((x) => d0(x.lap.distance));
    const dur = c.map((x) => d0(x.lap.duration));
    const onSameRound = dist.every(onRoundDistance) && distinct(dist.map(roundDistance)).length === 1;
    return !onSameRound && cv(dist) >= cv(dur);
  };
  const keys = [...clusters.keys()];
  const shortSingle = clusters.size === 1 && (keys[0] as number) < 150;
  if (shortSingle) {
    const c = [...clusters.values()][0] as LapInfo[];
    const cd = cv(c.map((x) => d0(x.lap.distance)));
    return work.length >= 6 && cd >= 0.03 && cd >= 3 * cv(c.map((x) => d0(x.lap.duration)));
  }
  return [...clusters.values()].filter((c) => c.length >= 3).every(wander);
}

function isLongRoundTime(durations: number[], distances: number[]): boolean {
  return (
    durations.length > 0 &&
    durations.every((d) => d >= 300 && d <= 1800 && Math.abs(d - nearestMultiple(d, 60)) <= LONG_TIMED_TOLERANCE) &&
    !distances.every((d) => Math.abs(d - nearestMultiple(d, 500)) <= 0.01 * d)
  );
}

function timedReps(durations: number[], distances: number[]): boolean {
  return (
    isLongRoundTime(durations, distances) ||
    (durations.length > 1 &&
      durations.every((d) => Math.abs(d - nearestMultiple(d, 15)) <= TIMED_TOLERANCE) &&
      cv(durations) < cv(distances) &&
      !distances.every(onRoundDistance))
  );
}

const isRoundTime = (t: number) => t >= 15 && Math.abs(t - nearestMultiple(t, 15)) <= 3.5;
const nearest50 = (d: number) => Math.max(50, roundToInt(d / 50) * 50);
function isRoundMeasure(d: number): boolean {
  if (d < 70) return false;
  const r = (d - nearest50(d)) / nearest50(d);
  return r >= -0.1 && r <= 0.15;
}

function isMeasuredGroup(laps: Lap[]): boolean {
  if (laps.length === 1) return false;
  const timeFit = laps.filter((l) => isRoundTime(nn(l.duration))).length / laps.length;
  const distFit = laps.filter((l) => isRoundMeasure(nn(l.distance))).length / laps.length;
  if (distFit >= 0.75 && timeFit < 0.5) return true;
  if (timeFit >= 0.5 && distFit < 0.75) return false;
  if (laps.length >= 3) {
    const distances = laps.map((l) => nn(l.distance));
    return cv(distances) < 0.07 && cv(distances) < cv(laps.map((l) => nn(l.duration))) * 0.7;
  }
  return false;
}

const prescribedTime = (t: number) => (t >= 45 ? Math.floor((t + 5) / 15) * 15 : t);
const nominalRecoveryDistance = (d: number) => (d < 950 ? `${roundToInt(nearest50(d))}${NBSP}m` : nominalDistance(d));
const valueOf = (l: Lap, measured: boolean) => (measured ? nn(l.distance) : nn(l.duration));

function classifyRecoveries(infos: LapInfo[], bucketLabels: string[], recoveryModes: Map<string, boolean>): RecoveryKind[] {
  const recoveries = infos.map((_, i) => i).filter((i) => (infos[i] as LapInfo).role === "RECOVERY" && infos[i - 1]?.role === "WORK");
  if (recoveries.length === 0) return [];
  const byGroup = new Map<number | null, number[]>();
  for (const r of recoveries) {
    const g = (infos[r - 1] as LapInfo).group;
    const list = byGroup.get(g);
    if (list) list.push(r);
    else byGroup.set(g, [r]);
  }
  const measuredGroups = new Map<number | null, boolean>();
  for (const [g, idx] of byGroup) {
    const mode = g !== null ? recoveryModes.get(bucketLabels[g] as string) : undefined;
    measuredGroups.set(g, mode !== undefined ? mode : isMeasuredGroup(idx.map((i) => (infos[i] as LapInfo).lap)));
  }
  const measured = recoveries.map((r) => measuredGroups.get((infos[r - 1] as LapInfo).group) === true);

  const kinds: RecoveryKind[] = [];
  for (const mode of [true, false]) {
    const val = (m: number) => valueOf((infos[recoveries[m] as number] as LapInfo).lap, mode);
    const members = recoveries.map((_, i) => i).filter((i) => measured[i] === mode).sort((a, b) => val(a) - val(b));
    let cluster: number[] = [];
    const close = () => {
      if (cluster.length === 0) return;
      const med = median(cluster.map(val));
      const label = mode ? nominalRecoveryDistance(med) : nominalDuration(prescribedTime(med));
      kinds.push({ label, measured: mode, laps: cluster.map((m) => infos[recoveries[m] as number] as LapInfo) });
      cluster = [];
    };
    for (const m of members) {
      if (cluster.length > 0 && val(m) > val(cluster[cluster.length - 1] as number) * 1.15) close();
      cluster.push(m);
    }
    close();
  }
  const firstIndex = (k: RecoveryKind) => Math.min(...k.laps.map((l) => infos.indexOf(l)));
  const ordered = [...kinds].sort((a, b) => firstIndex(a) - firstIndex(b));
  ordered.forEach((k, ki) => {
    for (const info of k.laps) {
      info.kind = ki;
      const prev = infos[infos.indexOf(info) - 1];
      if (prev) prev.kind = ki;
    }
  });
  return ordered;
}

function effortLabel(reps: LapInfo[], timedSession: boolean): string {
  const durations = reps.map((r) => nn(r.lap.duration));
  const distances = reps.map((r) => nn(r.lap.distance));
  return timedSession || timedReps(durations, distances) ? nominalDuration(mean(durations)) : nominalDistance(mean(distances));
}

interface Bucket {
  step: number | null;
  roundKey: number | null;
  timedKey: number | null;
  distances: number[];
  reps: LapInfo[];
}

/**
 * Rôles choisis à la main, un par tour de la liste d'origine (null : on garde celui qui a été trouvé).
 * Extension de la version PC : le Kotlin n'a pas encore cette correction manuelle.
 */
export type RoleOverrides = (LapRole | null)[];

export function analyze(laps: Lap[], recoveryModes: Map<string, boolean> = new Map(), overrides?: RoleOverrides): IntervalAnalysis | null {
  const kept: number[] = [];
  laps.forEach((l, i) => { if (l.distance !== null && d0(l.duration) > 0) kept.push(i); });
  const usable = kept.map((i) => laps[i] as Lap);
  if (usable.length < 3) return null;

  const tagged = structuredRoles(usable);
  const forced = overrides !== undefined && overrides.some((o) => o !== null);
  let roles = tagged ?? inferredRoles(usable);
  if (forced) {
    // Le point de départ est ce que la détection a trouvé (ou rien), puis les choix de l'utilisateur l'emportent.
    const base: LapRole[] = roles ?? usable.map(() => "OTHER");
    roles = base.map((r, i) => (overrides as RoleOverrides)[kept[i] as number] ?? r);
    if (roles.filter((r) => r === "WORK").length < 2) return null;
  }
  if (!roles) return null;
  const infos: LapInfo[] = usable.map((lap, i) => ({ lap, role: roles[i] as LapRole, group: null, rep: null, kind: null }));
  if (!forced && infos.filter((i) => i.role === "WORK").every((i) => d0(i.lap.distance) >= 5000) && !hasRealRecovery(infos)) return null;

  const timedSession = tagged === null && isTimedSession(infos.filter((i) => i.role === "WORK"));
  const sameType = (b: Bucket, d: number): boolean => {
    if (b.roundKey !== null && onRoundDistance(d)) return roundDistance(d) === b.roundKey;
    return Math.abs(d - mean(b.distances)) / mean(b.distances) < SAME_DISTANCE;
  };
  const buckets: Bucket[] = [];
  const sessionKeys = distinct(infos.filter((i) => i.role === "WORK").map((i) => timedKey(i.lap)).filter((k): k is number => k !== null));
  for (const info of infos) {
    if (info.role !== "WORK") continue;
    const d = nn(info.lap.distance);
    const step = tagged !== null ? info.lap.stepIndex : null;
    let timed: number | null = null;
    if (step === null && timedSession) {
      const own = timedKey(info.lap);
      if (own !== null) timed = own;
      else {
        const dur = nn(info.lap.duration);
        let nearest: number | null = null;
        for (const k of sessionKeys) if (nearest === null || Math.abs(k - dur) < Math.abs(nearest - dur)) nearest = k;
        timed = nearest !== null && Math.abs(nearest - dur) <= 0.12 * nearest ? nearest : null;
      }
    }
    let bucket: Bucket | undefined;
    if (step !== null) bucket = buckets.find((b) => b.step === step);
    else bucket = buckets.find((b) => b.step === null && (timed !== null ? b.timedKey === timed : b.timedKey === null && sameType(b, d)));
    if (!bucket) {
      bucket = { step, roundKey: onRoundDistance(d) ? roundDistance(d) : null, timedKey: timed, distances: [], reps: [] };
      buckets.push(bucket);
    }
    bucket.distances.push(d);
    bucket.reps.push(info);
    info.group = buckets.indexOf(bucket);
    info.rep = bucket.reps.length;
  }

  const recoveryKinds = classifyRecoveries(infos, buckets.map((b) => effortLabel(b.reps, timedSession)), recoveryModes);

  const describeRecovery = (rl: LapInfo[], kinds: RecoveryKind[]): Recovery => {
    const durations = rl.map((r) => nn(r.lap.duration));
    const distances = rl.map((r) => nn(r.lap.distance));
    const counts = new Map<string, number>();
    for (const r of rl) if (r.kind !== null) counts.set((kinds[r.kind] as RecoveryKind).label, (counts.get((kinds[r.kind] as RecoveryKind).label) ?? 0) + 1);
    const values = [...counts.values()];
    let labels: string[];
    if (values.length > 0 && Math.max(...values) >= sum(values) * 0.6) {
      let bestKey = "";
      let bestN = -1;
      for (const [k, n] of counts) if (n > bestN) { bestN = n; bestKey = k; }
      labels = [bestKey];
    } else labels = [...counts.keys()];
    const fallback = nominalDuration(nearestMultiple(median(durations), 15));
    const modes = distinct(rl.filter((r) => r.kind !== null).map((r) => ((kinds[r.kind as number] as RecoveryKind).measured ? 1 : 0)));
    const measured = modes.length === 1 ? modes[0] === 1 : null;
    return { duration: mean(durations), distance: mean(distances), speed: sum(distances) / sum(durations), label: labels.length > 0 ? labels.join(" / ") : fallback, measured };
  };

  const buildGroup = (reps: LapInfo[]): RepGroup => {
    const durations = reps.map((r) => nn(r.lap.duration));
    const distances = reps.map((r) => nn(r.lap.distance));
    let tempo = false;
    if (reps.length === 1 && infos.find((i) => i.role === "WORK") === reps[0]) {
      const others = infos.filter((i) => i.role === "WORK" && i !== reps[0]).map((i) => speedOf(i.lap));
      const d = durations[0] as number;
      const dist = nn((reps[0] as LapInfo).lap.distance);
      const slowTol = nearestMultiple(d, 60) === 180 && speedOf((reps[0] as LapInfo).lap) <= 0.9 * median(others.length ? others : [0]) ? 0.045 : 0.03;
      tempo =
        others.length >= 3 &&
        d >= 120 && d <= 300 &&
        dist < 1300 &&
        speedOf((reps[0] as LapInfo).lap) <= 0.93 * median(others) &&
        Math.abs(d - nearestMultiple(d, 60)) <= slowTol * d &&
        Math.abs(dist - roundDistance(dist)) / roundDistance(dist) > 0.004;
    }
    const timeBased = timedSession || tempo || timedReps(durations, distances);
    const speeds = reps.map((r) => speedOf(r.lap));
    const hrs = reps.map((r) => r.lap.averageHr).filter((h): h is number => h !== null);
    const recs: LapInfo[] = [];
    for (const r of reps) {
      const next = infos[infos.indexOf(r) + 1];
      if (next && next.role === "RECOVERY") recs.push(next);
    }
    return {
      label: tempo ? nominalDuration(nearestMultiple(durations[0] as number, 60)) : timeBased ? nominalDuration(mean(durations)) : nominalDistance(mean(distances)),
      timeBased,
      reps,
      avgSpeed: sum(distances) / sum(durations),
      avgDuration: mean(durations),
      avgDistance: mean(distances),
      avgHr: hrs.length > 0 ? roundToInt(mean(hrs)) : null,
      bestSpeed: Math.max(...speeds),
      worstSpeed: Math.min(...speeds),
      recovery: recs.length > 0 ? describeRecovery(recs, recoveryKinds) : null,
    };
  };

  const groups: RepGroup[] = [];
  for (const g of buckets.map((b) => buildGroup(b.reps))) {
    const twin = groups.findIndex((x) => x.label === g.label && x.timeBased === g.timeBased);
    if (twin === -1) groups.push(g);
    else groups[twin] = buildGroup([...(groups[twin] as RepGroup).reps, ...g.reps].sort((a, b) => infos.indexOf(a) - infos.indexOf(b)));
  }
  groups.forEach((g, gi) => g.reps.forEach((r, ri) => { r.group = gi; r.rep = ri + 1; }));

  const sequence = infos.filter((i) => i.role === "WORK").map((i) => i.group).filter((g): g is number => g !== null);
  const draft: IntervalAnalysis = { title: "", structured: tagged !== null, groups, laps: infos, recoveryKinds, sequence };
  const lay = layout(draft);
  const groupText = (g: RepGroup) => `${g.reps.length > 1 ? `${g.reps.length} × ` : ""}${g.label}${g.recovery ? ` (r${NBSP}: ${g.recovery.label})` : ""}`;
  const title = lay.block
    ? lay.efforts + (lay.entries.length < MAX_RECOVERIES_IN_TITLE ? ` (r${NBSP}: ${lay.entries.map((e) => e[1]).join(" + ")})` : "")
    : groups.map(groupText).join(" + ");
  return { ...draft, title };
}

export function layout(a: IntervalAnalysis): Layout {
  const groups = a.groups;
  const s = a.sequence;
  const label = (g: number) => (groups[g] as RepGroup).label;
  const rec = (g: number): string | null => (groups[g] as RepGroup).recovery?.label ?? null;
  const runs = (part: number[]): [string, string | null][] => {
    const out: [string, string | null][] = [];
    let i = 0;
    while (i < part.length) {
      let j = i;
      while (j + 1 < part.length && part[j + 1] === part[i]) j++;
      out.push([`${j > i ? `${j - i + 1} × ` : ""}${label(part[i] as number)}`, rec(part[i] as number)]);
      i = j + 1;
    }
    return out;
  };
  let best: [number, number, number] | null = null;
  for (let len = 2; len <= 4; len++) {
    for (let start = 0; start <= s.length - 2 * len; start++) {
      const pattern = s.slice(start, start + len);
      if (new Set(pattern).size < 2) continue;
      let n = 1;
      while (start + (n + 1) * len <= s.length && s.slice(start + n * len, start + (n + 1) * len).every((v, k) => v === pattern[k])) n++;
      const block = (n >= 3 && n * len >= 0.7 * s.length) || (n === 2 && len >= 3 && n * len === s.length);
      if (block && (best === null || n * len > best[1] * best[2])) best = [start, len, n];
    }
  }
  if (best === null) {
    const entries: [string, string][] = [];
    for (const g of groups) if (g.recovery) entries.push([`${g.reps.length > 1 ? `${g.reps.length} × ` : ""}${g.label}`, g.recovery.label]);
    return { efforts: groups.map((g) => `${g.reps.length > 1 ? `${g.reps.length} × ` : ""}${g.label}`).join(" + "), entries, block: false };
  }
  const [start, len, n] = best;
  const pattern = s.slice(start, start + len);
  const before = runs(s.slice(0, start));
  const after = runs(s.slice(start + n * len));
  const work = a.laps.filter((l) => l.role === "WORK");
  const recoveryAfter = (p: number): string | null => {
    const info = work.length === s.length ? work[start + p] : undefined;
    if (!info) return rec(pattern[p] as number);
    const next = a.laps[a.laps.indexOf(info) + 1];
    const nextRec = next && next.role === "RECOVERY" ? next : undefined;
    const kindLabel = nextRec && nextRec.kind !== null ? a.recoveryKinds[nextRec.kind]?.label : undefined;
    return kindLabel ?? rec(pattern[p] as number);
  };
  const parts = [...before.map((b) => b[0]), `${n} × (${runs(pattern).map((r) => r[0]).join(" + ")})`, ...after.map((x) => x[0])];
  const entries: [string, string][] = [];
  for (const [l, r] of before) if (r !== null) entries.push([l, r]);
  pattern.forEach((g, p) => {
    const r = recoveryAfter(p);
    if (r !== null) entries.push([label(g), r]);
  });
  for (const [l, r] of after) if (r !== null) entries.push([l, r]);
  return { efforts: parts.join(" + "), entries, block: true };
}

export type RoleSource = "garmin" | "deduit" | "manuel" | "aucun";

/**
 * Le rôle de chaque tour de la liste d'origine, et d'où il vient : la montre (séance structurée), la déduction par les allures
 * (tours pressés à la main), le choix de l'utilisateur. Sert à demander une vérification quand les tours sont déduits.
 */
export function describeLaps(laps: Lap[], overrides?: RoleOverrides): { roles: LapRole[]; source: RoleSource; analysis: IntervalAnalysis | null } {
  const analysis = analyze(laps, new Map(), overrides);
  const forced = overrides !== undefined && overrides.some((o) => o !== null);
  const roles: LapRole[] = laps.map(() => "OTHER");
  if (analysis) {
    let k = 0;
    laps.forEach((l, i) => {
      if (l.distance !== null && d0(l.duration) > 0) roles[i] = (analysis.laps[k++] as LapInfo).role;
    });
  }
  const source: RoleSource = !analysis ? "aucun" : forced ? "manuel" : analysis.structured ? "garmin" : "deduit";
  return { roles, source, analysis };
}

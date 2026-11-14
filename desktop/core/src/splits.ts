// Temps au kilomètre interpolés sur la courbe : portage de Splits.kt.
import type { Sample } from "./model";

export interface Split { km: number; distance: number; duration: number; averageHr: number | null; elevationGain: number }

export function computeSplits(samples: Sample[]): Split[] {
  const pts = samples.filter((s) => s.d !== null && s.t !== null) as (Sample & { d: number; t: number })[];
  if (pts.length < 2) return [];
  const splits: Split[] = [];
  let startT = (pts[0] as { t: number }).t;
  let startD = (pts[0] as { d: number }).d;
  let nextKm = Math.trunc(startD / 1000) + 1;
  let hrSum = 0, hrCount = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Sample & { d: number; t: number };
    const b = pts[i] as Sample & { d: number; t: number };
    if (b.hr !== null) { hrSum += b.hr; hrCount++; }
    if (a.ele !== null && b.ele !== null && b.ele > a.ele) gain += b.ele - a.ele;
    while (b.d >= nextKm * 1000 && b.d > a.d) {
      const boundary = nextKm * 1000;
      const t = a.t + ((boundary - a.d) / (b.d - a.d)) * (b.t - a.t);
      splits.push({ km: nextKm, distance: boundary - startD, duration: t - startT, averageHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null, elevationGain: gain });
      startT = t; startD = boundary; nextKm++; hrSum = 0; hrCount = 0; gain = 0;
    }
  }
  const last = pts[pts.length - 1] as Sample & { d: number; t: number };
  if (last.d - startD > 100) splits.push({ km: nextKm, distance: last.d - startD, duration: last.t - startT, averageHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null, elevationGain: gain });
  return splits;
}

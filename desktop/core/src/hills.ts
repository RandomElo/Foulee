// Répétitions de côtes lues sur la courbe d'altitude, quand la montre n'a pas de tours pour le dire (une séance de « 10 côtes » enregistrée en un seul tour).
// Portage de Hills.kt. L'altitude est lissée sur trois points, puis découpée en montées (au moins MIN_GAIN mètres entre un bas et le haut suivant, le haut étant
// le sommet des WINDOW premières secondes : une pente qui monte doucement n'est pas une répétition). Une séance de côtes est la plus longue suite d'au moins
// MIN_REPS montées qui se ressemblent (gain à 50 % de la médiane, durée à 50 %, rythme régulier d'un départ au suivant, pas de longue pause).
// Seulement quand les tours ne donnent aucune séance de fractionné : les tours gagnent toujours.
import { NBSP, roundToInt } from "./format";
import type { Sample } from "./model";

const MIN_GAIN = 5;
const MAX_GAIN = 80;
const MIN_SECONDS = 12;
const MAX_SECONDS = 240;
const WINDOW = 150;
const MARGIN = 1.5;
const LEAD_IN = 60;
const MIN_REPS = 5;

/** `start` et `end` en secondes, `gain` en mètres, `meters` la distance courue dans la côte quand la courbe a des distances. */
export interface Climb { start: number; end: number; gain: number; meters: number | null }
const seconds = (c: Climb) => c.end - c.start;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

const smooth = (e: number[]) => e.map((_, i) => { const w = e.slice(Math.max(0, i - 1), Math.min(e.length, i + 2)); return w.reduce((a, b) => a + b, 0) / w.length; });

/** Les bas et hauts successifs distants d'au moins `h` mètres : (indice, est un haut). */
function pivots(e: number[], h = MIN_GAIN): [number, boolean][] {
  const out: [number, boolean][] = [];
  let dir = 0, mn = 0, mx = 0;
  for (let i = 1; i < e.length; i++) {
    const v = e[i] as number;
    if (dir === 0) {
      if (v - (e[mn] as number) >= h) { out.push([mn, false]); dir = 1; mx = i; }
      else if ((e[mx] as number) - v >= h) { out.push([mx, true]); dir = -1; mn = i; }
      else { if (v < (e[mn] as number)) mn = i; if (v > (e[mx] as number)) mx = i; }
    } else if (dir === 1) {
      if (v > (e[mx] as number)) mx = i;
      else if ((e[mx] as number) - v >= h) { out.push([mx, true]); dir = -1; mn = i; }
    } else {
      if (v < (e[mn] as number)) mn = i;
      else if (v - (e[mn] as number) >= h) { out.push([mn, false]); dir = 1; mx = i; }
    }
  }
  if (dir === 1) out.push([mx, true]); else if (dir === -1) out.push([mn, false]);
  return out;
}

export function climbs(samples: Sample[]): Climb[] {
  const pts = samples.filter((s): s is Sample & { t: number; ele: number } => s.t !== null && s.ele !== null);
  if (pts.length < 30) return [];
  const t = pts.map((s) => s.t);
  const d = pts.map((s) => s.d);
  const e = smooth(pts.map((s) => s.ele));
  const p = pivots(e);
  const out: Climb[] = [];
  for (let k = 0; k < p.length - 1; k++) {
    const [i, aHigh] = p[k] as [number, boolean];
    const [j, bHigh] = p[k + 1] as [number, boolean];
    if (!aHigh && bHigh) {
      // Après un long plat (plus de LEAD_IN secondes), la montée part du dernier point encore à moins de MARGIN mètres du bas : le plat n'en fait pas partie.
      let st = i;
      for (let x = i; x <= j; x++) if ((e[x] as number) <= (e[i] as number) + MARGIN) st = x;
      if ((t[st] as number) - (t[i] as number) <= LEAD_IN) st = i;
      let top = st;
      for (let x = st; x <= j; x++) if ((t[x] as number) - (t[st] as number) <= WINDOW && (e[x] as number) > (e[top] as number)) top = x;
      const dS = d[st] ?? null, dT = d[top] ?? null;
      out.push({ start: t[st] as number, end: t[top] as number, gain: (e[top] as number) - (e[st] as number), meters: dS !== null && dT !== null ? dT - dS : null });
    }
  }
  return out;
}

/** La plus longue suite de montées qui se ressemblent, ou vide. */
export function bestRun(cl: Climb[]): Climb[] {
  let best: Climb[] = [];
  for (let s = 0; s < cl.length; s++) {
    for (let f = s + MIN_REPS; f <= cl.length; f++) {
      const seg = cl.slice(s, f);
      if (seg.length <= best.length) continue;
      const gain = median(seg.map((c) => c.gain));
      const dur = median(seg.map(seconds));
      const alike = seg.every((c) => Math.abs(c.gain - gain) <= 0.5 * gain && Math.abs(seconds(c) - dur) <= 0.5 * dur && c.gain >= MIN_GAIN && c.gain <= MAX_GAIN && seconds(c) >= MIN_SECONDS && seconds(c) <= MAX_SECONDS);
      if (!alike) continue;
      const gaps = seg.slice(1).map((c, i) => c.start - (seg[i] as Climb).start);
      const gap = median(gaps);
      if (gaps.every((g) => Math.abs(g - gap) <= 0.4 * gap) && gap <= 4 * dur + 60) best = seg;
    }
  }
  return best;
}


/** La longueur d'une côte arrondie comme on l'appelle : à 10 m sous 75 m, à 50 m jusqu'à 950 m, à 100 m au-delà (111 m se dit « 100 m »). */
function roundLength(m: number): number {
  const step = m < 75 ? 10 : m < 950 ? 50 : 100;
  return Math.max(step, roundToInt(m / step) * step);
}

/** « 10 × côte de 100 m (39 s, +10 m) », ou null quand la courbe ne montre pas de répétitions de côtes. Sans distances dans la courbe : « 10 × côte de 10 m (39 s) ». */
export function hillsTitle(samples: Sample[]): string | null {
  const run = bestRun(climbs(samples));
  if (run.length === 0) return null;
  const lengths = run.map((c) => c.meters).filter((m): m is number => m !== null);
  if (lengths.length * 10 >= run.length * 6) return `${run.length} × côte de ${roundLength(median(lengths))}${NBSP}m`;
  return `${run.length} × côtes`;
}

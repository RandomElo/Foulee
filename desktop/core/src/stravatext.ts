// Nom et description d'une séance sur Strava : portage de StravaTextBuilder (StravaText.kt).
import { dec, NBSP } from "./format";
import { layout, MAX_RECOVERIES_IN_TITLE, type IntervalAnalysis, type RepGroup } from "./intervals";
import { loadZoneOf } from "./sessions";
import { racePaces, type RefsNum } from "./refs";
import type { ActivityRow } from "./model";

export interface StravaText {
  name: string;
  description: string;
  interval: boolean;
}

const SPE_TOLERANCE = 0.025;
const SPE_MIN_REP_METERS = 800;
const SPE_MIN_REP_SECONDS = 150;
export const SIGNATURE = "🤖 Généré par Foulée";

/** La proposition faite à Eloi, jamais appliquée seule : « 5 km », « 10 km », « semi » ou « marathon » quand les répétitions principales courent à cette allure (jamais les courtes). */
export function proposedSpeciality(analysis: IntervalAnalysis, refs: RefsNum): string | null {
  const longues = analysis.groups.filter((g) => g.avgDistance >= SPE_MIN_REP_METERS || g.avgDuration >= SPE_MIN_REP_SECONDS);
  let main: RepGroup | undefined;
  for (const g of longues) if (!main || g.reps.length * g.avgDistance > main.reps.length * main.avgDistance) main = g;
  if (!main || main.avgSpeed <= 0) return null;
  const pace = 1000 / main.avgSpeed;
  let best: [string, number] | undefined;
  for (const p of racePaces(refs)) if (!best || Math.abs(p[1] - pace) < Math.abs(best[1] - pace)) best = p;
  if (!best) return null;
  return Math.abs(pace - best[1]) / best[1] <= SPE_TOLERANCE ? best[0] : null;
}

/** 3:21 /km écrit « 3 min 21 / km », comme le reste de ses textes Strava. */
function pace(speed: number): string {
  const s = Math.round(1000 / speed);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} / km`;
}

/** Sa façon de l'écrire sur Strava : espaces simples, « x », « sec ». */
export function plain(text: string): string {
  return text.split(NBSP).join(" ").replace(/×/g, "x").replace(/(\d) s\b/g, "$1 sec");
}

/** « Charge 14,9/20 (Progression) » : le chiffre avec le terme d'entraînement où il tombe. */
export function figures(load: number | null): string | null {
  return load === null ? null : `Charge ${dec(load)}/20 (${loadZoneOf(load).label})`;
}

function describe(lines: string[], load: number | null, remark: string | null, week: string[] | null, recovery: string | null): string {
  const extra = [remark, recovery, figures(load)].filter((x): x is string => x !== null);
  return [...lines, ...extra, ...(week ? ["", ...week, ""] : []), SIGNATURE].join("\n");
}

/** Le texte d'un fractionné : « Spé 5 km - 2000 m + 1000 m + 5 x 200 m ( r : 2 min 30 + 3 min + 100 m ) » en nom, une ligne par type d'effort en description. */
export function buildInterval(analysis: IntervalAnalysis, load: number | null, remark: string | null, speciality: string | null, week: string[] | null = null, recovery: string | null = null): StravaText {
  const spe = speciality && speciality !== "none" ? speciality : null;
  const lay = layout(analysis);
  const inName = lay.entries.length < MAX_RECOVERIES_IN_TITLE;
  const all = lay.entries.map((e) => e[1]);
  const recoveries = new Set(all).size === 1 ? [all[0] as string] : all;
  const name = plain((spe ? `Spé ${spe} - ` : "Fractionné - ") + lay.efforts + (inName && recoveries.length > 0 ? ` ( r : ${recoveries.join(" + ")} )` : ""));
  const lines = analysis.groups.map((g) => `${plain(g.label)} : ${pace(g.avgSpeed)}`);
  if (!inName) lines.push(plain("Récups : " + lay.entries.map(([element, rec]) => `${element} : ${rec}`).join(" · ")));
  return { name, description: describe(lines, load, remark, week, recovery), interval: true };
}

/** Un footing ou une sortie longue : juste « Footing » (ou « Sortie longue ») en nom, et la charge comme seul chiffre. */
export function buildEasy(a: ActivityRow, category: string, load: number | null, week: string[] | null = null, recovery: string | null = null): StravaText | null {
  if ((a.distance ?? 0) <= 0 || (a.duration ?? 0) <= 0) return null;
  return { name: category === "long" ? "Sortie longue" : "Footing", description: describe([], load, null, week, recovery), interval: false };
}

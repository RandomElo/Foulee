// Bilan de la semaine et alerte de récupération : portage de WeekReview, WeekReviews et RecoveryCheck (Coaching.kt).
import { addDays, daysBetween } from "./dates";
import { dec, roundToInt } from "./format";
import { categoryOf } from "./categories";
import type { Analysis, Factor } from "./insights";
import { isRun, type ActivityRow } from "./model";
import { loadZoneOf, sessionsOfDay, type LoadZone } from "./sessions";
import { plain } from "./stravatext";
import type { SessionHistory } from "./sessionanalysis";

/** Une séance de fractionné de la semaine : son jour, son titre sans les récups, la remarque et la première phrase de son analyse. */
export interface WeekInterval { day: string; title: string; remark: string | null; summary: string | null }

/** À quoi ressemblait une semaine : les chiffres, puis un petit point sur le travail dur. */
export interface WeekReview {
  monday: string;
  km: number;
  sessions: number;
  runs: number;
  lastKm: number;
  load: number | null;
  zone: LoadZone | null;
  intervals: WeekInterval[];
  intensePct: number | null;
}

/** « 6 × 1000 m (r : 200 m) » devient « 6 × 1000 m » : le bilan montre les efforts, pas les récupérations. */
export const withoutRecoveries = (title: string): string => title.replace(/\s*\(r[\s ]*:[^)]*\)/g, "");

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const dayName = (iso: string) => JOURS[new Date(`${iso}T12:00:00`).getDay()] as string;
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
const mondayOf = (iso: string) => addDays(iso, -((weekdayOf(iso) + 6) % 7));
const sessionWord = (n: number) => `${n} ${n > 1 ? "séances" : "séance"}`;

/** Le texte du bilan, ligne par ligne, tel qu'il va dans la description Strava. */
export function weekLines(w: WeekReview): string[] {
  const out: string[] = [`Bilan de la semaine : ${dec(w.km, 0)} km en ${sessionWord(w.sessions)}` + (w.lastKm > 0 ? ` (${dec(w.lastKm, 0)} km la semaine d'avant).` : ".")];
  if (w.load !== null && w.zone !== null) out.push(`Charge globale : ${dec(w.load)}/20 (${w.zone.label}).`);
  out.push("");
  if (w.intervals.length === 0) out.push("Pas de fractionné cette semaine.");
  else {
    out.push("Fractionné :");
    w.intervals.forEach((s, i) => {
      if (i > 0) out.push("");
      out.push(`${dayName(s.day)} : ${plain(s.title)}`);
      if (s.remark) out.push(s.remark);
    });
  }
  if (w.intensePct !== null) { out.push(""); out.push(`${w.intensePct} % du temps en zone 4 ou 5.`); }
  return out;
}

/** La semaine (du lundi à `date`) des sorties de `activities`, ou null s'il n'y a pas eu de course. */
export function weekReviewOf(date: string, activities: ActivityRow[], analysis: Analysis, history: SessionHistory | null): WeekReview | null {
  const monday = mondayOf(date);
  const day = (a: ActivityRow) => a.startLocal.slice(0, 10);
  const runs = activities.filter((a) => a.id > 0 && isRun(a) && day(a) >= monday && day(a) <= date);
  if (runs.length === 0) return null;
  const before = activities.filter((a) => a.id > 0 && isRun(a) && day(a) >= addDays(monday, -7) && day(a) < monday);
  const zones = runs.map((a) => a.hrZones).filter((z): z is number[] => Array.isArray(z) && z.length >= 5);
  const total = zones.reduce((s, z) => s + z.reduce((a, b) => a + b, 0), 0);
  const hard = zones.reduce((s, z) => s + (z[3] as number) + (z[4] as number), 0);
  const load = analysis.globalPartsOn(date)?.total ?? null;
  const intervals = runs.filter((a) => categoryOf(a) === "interval").sort((a, b) => (a.startLocal < b.startLocal ? -1 : 1)).flatMap((a): WeekInterval[] => {
    if (a.intervalTitle === null) return [];
    const note = history?.noteOf(a.id) ?? null;
    return [{ day: day(a), title: withoutRecoveries(a.intervalTitle), remark: note?.remark ?? null, summary: note?.summary ?? null }];
  });
  const byDay = new Map<string, ActivityRow[]>();
  for (const a of runs) byDay.set(day(a), [...(byDay.get(day(a)) ?? []), a]);
  const sessions = [...byDay.values()].reduce((s, d) => s + sessionsOfDay(d), 0);
  return {
    monday, km: runs.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000, sessions, runs: runs.length, lastKm: before.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000,
    load, zone: load !== null ? loadZoneOf(load) : null, intervals, intensePct: total > 0 ? roundToInt((100 * hard) / total) : null,
  };
}

/** Vrai le dimanche : le jour où le bilan part sur Strava et s'affiche à l'accueil. */
export const isReviewDay = (date: string): boolean => weekdayOf(date) === 0;

/** Le bilan à montrer à l'accueil : la semaine en cours le dimanche, la semaine qui vient de finir le lundi. */
export function weekReviewForHome(today: string, activities: ActivityRow[], analysis: Analysis, history: SessionHistory | null): WeekReview | null {
  const d = weekdayOf(today);
  return d === 0 ? weekReviewOf(today, activities, analysis, history) : d === 1 ? weekReviewOf(addDays(today, -1), activities, analysis, history) : null;
}

// ---------- Alerte de récupération ----------

export interface RecoveryAlert { score: number; label: string; causes: string[]; tips: string[] }

/** Sous cette forme (sur 100) la récupération est dite mauvaise : « Fatigué » et « À ménager ». */
export const RECOVERY_LIMIT = 52;

function causeOf(f: Factor): [string, string] | null {
  switch (f.key) {
    case "sleep": return [`Nuit courte : ${f.display}, ${f.note}`, "Dors plus ce soir : vise ta durée habituelle ou un peu plus."];
    case "sleepScore": return [`Sommeil de mauvaise qualité : ${f.display}`, "Soigne ta soirée : écrans, repas lourd et alcool abîment le sommeil."];
    case "hrv": return [`VFC basse : ${f.display}, ${f.note}`, "Une VFC basse dit que ton corps est sous tension : évite l'intensité aujourd'hui."];
    case "restingHr": return [`FC au repos élevée : ${f.display}, ${f.note}`, "Une FC de repos qui monte, c'est de la fatigue, du stress ou un début de maladie."];
    case "bodyBattery": return [`Body Battery basse au réveil : ${f.display}`, "Ta Body Battery ne s'est pas rechargée : repose-toi avant de forcer."];
    case "stress": return [`Journée stressante : ${f.display}`, "Le stress freine la récupération : garde du temps pour souffler."];
    case "fatigue": return [`Charge élevée ces derniers jours : ${f.display}`, "Allège les prochains jours : footings faciles, pas de fractionné."];
    default: return null;
  }
}

/** Une mauvaise récupération du jour : la forme du matin est sous la bande « correcte ». Null quand tout va bien. */
export function recoveryAlert(analysis: Analysis, activities: ActivityRow[], today: string): RecoveryAlert | null {
  const r = analysis.readiness;
  if (!r || r.score >= RECOVERY_LIMIT) return null;
  const found = r.factors.filter((f) => f.status === "low").sort((a, b) => a.z - b.z).map(causeOf).filter((c): c is [string, string] => c !== null);
  // La séance des deux derniers jours est une cause en soi.
  const hard = activities.filter((a) => isRun(a) && (categoryOf(a) === "interval" || categoryOf(a) === "competition") && daysBetween(a.startLocal.slice(0, 10), today) <= 2 && a.startLocal.slice(0, 10) <= today);
  if (hard.length > 0) {
    const last = hard.reduce((m, a) => (a.startLocal > m.startLocal ? a : m));
    found.push([`Séance dure récente : ${last.intervalTitle !== null ? withoutRecoveries(last.intervalTitle) : "course"}`, "Laisse 48 h entre deux séances dures."]);
  }
  if (found.length === 0) found.push(["Pas de cause nette dans tes données", "Une récupération moyenne se règle souvent avec un jour facile."]);
  return { score: r.score, label: r.label, causes: found.map((f) => f[0]), tips: [...new Set(found.map((f) => f[1])), "Aujourd'hui : repos ou footing très facile."] };
}

/** La ligne de la description Strava : seulement quand la récupération de ce matin-là était mauvaise. */
export const recoveryLine = (score: number | null): string | null => (score !== null && score < RECOVERY_LIMIT ? `Récupération faible ce matin (forme ${score}/100).` : null);

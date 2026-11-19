// Le profil du coureur, bâti seulement sur ce que l'appli stocke : volume et régularité (séances), dosage de l'intensité (types de séance), corps (lignes de santé).
// Chaque phrase vient d'un chiffre mesuré et d'un seuil, rien n'est deviné. Portage de Profile.kt. Le VO2 max de Garmin n'est pas lu par le PC : sa remarque est absente.
import { addDays } from "./dates";
import { categoryOf } from "./categories";
import { dec, roundToInt } from "./format";
import type { Analysis } from "./insights";
import { isRun, type ActivityRow, type DailyRow } from "./model";
import { weekStart } from "./weeks";

/** Une observation sur le coureur : `good` = un point fort, sinon quelque chose à surveiller. */
export interface Finding { good: boolean; title: string; text: string }
export interface Figure { label: string; value: string; caption: string | null }
/** Un côté de l'entraînement noté de 0 à 100 face à un objectif simple, avec quoi faire quand il traîne. */
export interface Dimension { label: string; score: number; advice: string; detail: string; dots: [number, number] | null; how: string }
export interface ProfileReport { figures: Figure[]; dimensions: Dimension[]; findings: Finding[]; summary: string | null }

/** Sous ce score une dimension est à travailler (85 et plus : objectif atteint, entre les deux : correct). */
export const WEAK_BELOW = 70;

/** La dimension la plus basse, seulement si elle est vraiment basse : un 97 qui est le plus bas de cinq bons scores n'est pas un point faible. */
export function weakest(r: ProfileReport): Dimension | null {
  const low = r.dimensions.reduce<Dimension | null>((m, d) => (m === null || d.score < m.score ? d : m), null);
  return low && low.score < WEAK_BELOW ? low : null;
}

const avg = (v: (number | null)[]): number | null => { const k = v.filter((x): x is number => x !== null); return k.length > 0 ? k.reduce((a, b) => a + b, 0) / k.length : null; };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const percent = (v: number) => `${roundToInt(v)} %`;
const clamp = (v: number) => roundToInt(Math.min(Math.max(v, 0), 100));
const plural = (n: number, w: string) => `${n} ${n > 1 ? `${w}s` : w}`;
const hoursMinutes = (seconds: number) => { const m = roundToInt(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
const dayMonth = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");
const monthName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { month: "long" });

interface Week { start: string; distance: number; count: number }

export function computeProfile(activities: ActivityRow[], daily: DailyRow[], analysis: Analysis, today: string): ProfileReport {
  const runs = activities.filter(isRun);
  if (runs.length === 0) return { figures: [], dimensions: [], findings: [], summary: null };
  const findings: Finding[] = [];
  const dimensions: Dimension[] = [];

  // 26 semaines jusqu'à la semaine en cours, y compris celles sans sortie.
  const monday = weekStart(today);
  const all: Week[] = Array.from({ length: 26 }, (_, k) => {
    const start = addDays(monday, -7 * (25 - k));
    const list = runs.filter((a) => a.startLocal.slice(0, 10) >= start && a.startLocal.slice(0, 10) <= addDays(start, 6));
    return { start, distance: list.reduce((s, a) => s + (a.distance ?? 0), 0), count: list.length };
  });
  // Semaines complètes seulement : la semaine en cours n'est pas finie.
  const weeks = all.slice(0, -1);
  const last12 = weeks.slice(-12);
  const weeklyKm = last12.length > 0 ? mean(last12.map((w) => w.distance / 1000)) : null;
  const weeklyRuns = last12.length > 0 ? mean(last12.map((w) => w.count)) : null;

  if (last12.length >= 6) {
    const regular = last12.filter((w) => w.count >= 3).length;
    const sparse = last12.filter((w) => w.count < 2).length;
    dimensions.push({
      label: "Régularité", score: clamp((regular * 100) / last12.length), advice: "Viser 3 sorties chaque semaine, même courtes, rend la progression plus sûre.",
      detail: `${regular} semaines sur ${last12.length} avec au moins 3 sorties`, dots: [regular, last12.length], how: "100 = au moins 3 sorties chaque semaine pendant 12 semaines.",
    });
    if (last12.length >= 8) {
      if (regular >= last12.length * 0.8) findings.push({ good: true, title: "Régularité", text: `${regular} semaines sur ${last12.length} avec au moins 3 sorties. C'est la base de la progression.` });
      else if (sparse >= 3) findings.push({ good: false, title: "Régularité", text: `${sparse} semaines sur ${last12.length} avec moins de 2 sorties : les interruptions freinent la progression.` });
    }
  }

  const recent4 = weeks.slice(-4).map((w) => w.distance / 1000);
  const before8 = weeks.slice(0, -4).slice(-8).map((w) => w.distance / 1000);
  if (recent4.length === 4 && before8.length >= 6 && mean(before8) >= 10) {
    const change = (mean(recent4) / mean(before8) - 1) * 100;
    if (change > 30) findings.push({ good: false, title: "Hausse rapide du volume", text: `+${percent(change)} de kilomètres sur 4 semaines par rapport aux 8 d'avant. Une montée aussi vite expose aux blessures : laisse le corps s'adapter.` });
    else if (change >= 5) findings.push({ good: true, title: "Volume en progression", text: `+${percent(change)} de kilomètres sur 4 semaines par rapport aux 8 d'avant, à un rythme que le corps absorbe bien.` });
    else if (change <= -30) findings.push({ good: false, title: "Volume en baisse", text: `${percent(change)} de kilomètres sur 4 semaines par rapport aux 8 d'avant.` });
  }
  // Le volume face à ses propres meilleures semaines
  const best8 = [...all].sort((a, b) => b.distance - a.distance).slice(0, 8).map((w) => w.distance / 1000);
  if (recent4.length === 4 && best8.length === 8 && mean(best8) > 0) {
    dimensions.push({
      label: "Volume", score: clamp((mean(recent4) / mean(best8)) * 100), advice: "Remonte progressivement, sans dépasser environ 10 % de plus d'une semaine à l'autre.",
      detail: `${dec(mean(recent4), 0)} km par semaine sur 4 semaines, contre ${dec(mean(best8), 0)} sur tes 8 meilleures`, dots: null, how: "100 = tes 4 dernières semaines valent la moyenne de tes 8 meilleures semaines.",
    });
  }

  // Le dosage des séances sur les 8 dernières semaines
  const since8 = addDays(today, -56);
  const recentRuns = runs.filter((a) => a.startLocal.slice(0, 10) >= since8);
  if (recentRuns.length >= 8) {
    const hard = recentRuns.filter((a) => categoryOf(a) === "interval" || categoryOf(a) === "competition").length;
    const share = (hard * 100) / recentRuns.length;
    if (share > 40) findings.push({ good: false, title: "Beaucoup de séances dures", text: `${percent(share)} de tes sorties des 8 dernières semaines sont dures (fractionné ou compétition). Trop d'intensité gêne la récupération : environ 20 % suffit à progresser.` });
    else if (share >= 10 && share <= 30) findings.push({ good: true, title: "Bonne répartition de l'intensité", text: `${percent(share)} de séances dures sur 8 semaines, le reste en endurance facile : le dosage classique des coureurs qui progressent.` });
    else if (share < 5) findings.push({ good: false, title: "Peu d'intensité", text: "Presque aucune séance dure en 8 semaines. Un peu de fractionné fait progresser la vitesse." });
    dimensions.push({
      label: "Équilibre", score: clamp(100 - Math.abs(share - 20) * 4), advice: share > 20 ? "Ajoute des footings vraiment faciles entre les séances rapides." : "Une séance rapide de plus par semaine ferait progresser.",
      detail: `${percent(share)} de séances dures, objectif environ 20 %`, dots: null, how: "100 = environ 20 % de séances dures (fractionné, compétition) sur 8 semaines. Plus ou moins fait baisser le score.",
    });
    const intervals = recentRuns.filter((a) => categoryOf(a) === "interval").length;
    if (intervals >= 6) findings.push({ good: true, title: "Fractionné régulier", text: `${intervals} séances de fractionné en 8 semaines.` });
    dimensions.push({
      label: "Vitesse", score: clamp((intervals * 100) / 6), advice: "Une séance rapide par semaine fait progresser la vitesse.",
      detail: `${plural(intervals, "fractionné")} en 8 semaines, objectif 6`, dots: [Math.min(intervals, 6), 6], how: "100 = 6 séances de fractionné en 8 semaines.",
    });
    const longRuns = recentRuns.filter((a) => categoryOf(a) === "long" || (a.duration ?? 0) >= 5400).length;
    if (longRuns >= 3) findings.push({ good: true, title: "Endurance", text: `${longRuns} sorties longues (19 km ou plus, ou plus d'1 h 30) en 8 semaines.` });
    else if (longRuns === 0) findings.push({ good: false, title: "Pas de sortie longue", text: "Aucune sortie de plus d'1 h 30 en 8 semaines : elle construit l'endurance de fond." });
    dimensions.push({
      label: "Endurance", score: clamp((longRuns * 100) / 3), advice: "Une sortie longue toutes les une à deux semaines construit l'endurance de fond.",
      detail: `${plural(longRuns, "sortie longue")} en 8 semaines, objectif 3`, dots: [Math.min(longRuns, 3), 3], how: "100 = 3 sorties longues (plus d'1 h 30) en 8 semaines.",
    });
  }

  // Le corps : les 14 derniers jours contre les 60 d'avant
  const recentFrom = addDays(today, -14);
  const baseFrom = addDays(today, -74);
  const recent = daily.filter((d) => d.date >= recentFrom);
  const base = daily.filter((d) => d.date >= baseFrom && d.date < recentFrom);
  if (recent.length >= 7 && base.length >= 20) {
    const rhrNow = avg(recent.map((d) => d.restingHr)), rhrBase = avg(base.map((d) => d.restingHr));
    let rhrScore: number | null = null;
    if (rhrNow !== null && rhrBase !== null) {
      const diff = rhrNow - rhrBase;
      rhrScore = 100 - 12 * Math.max(0, diff);
      if (diff <= -2) findings.push({ good: true, title: "FC au repos en baisse", text: `${dec(Math.abs(diff), 0)} bpm de moins que d'habitude (${roundToInt(rhrNow)} bpm) : le cœur travaille moins pour le même repos, bon signe de forme.` });
      else if (diff >= 3) findings.push({ good: false, title: "FC au repos en hausse", text: `${dec(diff, 0)} bpm de plus que d'habitude (${roundToInt(rhrNow)} bpm) : peut venir de la fatigue, du stress ou d'un début de maladie.` });
    }
    const hrvNow = avg(recent.map((d) => d.hrvNight)), hrvBase = avg(base.map((d) => d.hrvNight));
    let hrvScore: number | null = null;
    if (hrvNow !== null && hrvBase !== null && hrvBase > 0) {
      const change = (hrvNow / hrvBase - 1) * 100;
      hrvScore = change >= 0 ? 100 : 100 + change * 4;
      if (change >= 8) findings.push({ good: true, title: "VFC en hausse", text: `+${percent(change)} par rapport à tes 2 mois d'avant : le corps récupère bien.` });
      else if (change <= -10) findings.push({ good: false, title: "VFC en baisse", text: `${percent(change)} par rapport à tes 2 mois d'avant : le corps encaisse moins bien la charge.` });
    }
    const sleep = avg(recent.map((d) => d.sleepSeconds));
    let sleepScore: number | null = null;
    if (sleep !== null) {
      sleepScore = (sleep / (7.5 * 3600)) * 100;
      if (sleep >= 7.5 * 3600) findings.push({ good: true, title: "Sommeil suffisant", text: `${hoursMinutes(sleep)} de sommeil par nuit en moyenne sur 14 jours.` });
      else if (sleep < 6.75 * 3600) findings.push({ good: false, title: "Sommeil court", text: `${hoursMinutes(sleep)} par nuit en moyenne sur 14 jours : le sommeil est ce qui fait absorber l'entraînement.` });
    }
    const parts = [sleepScore, rhrScore, hrvScore].filter((x): x is number => x !== null);
    const note = [
      sleep !== null ? `sommeil ${hoursMinutes(sleep)}` : null,
      rhrNow !== null && rhrBase !== null ? (Math.abs(rhrNow - rhrBase) < 0.5 ? "FC repos stable" : `FC repos ${rhrNow >= rhrBase ? "+" : "−"}${dec(Math.abs(rhrNow - rhrBase), 0)} bpm`) : null,
      hrvNow !== null && hrvBase !== null ? (Math.abs(hrvNow - hrvBase) < 0.5 ? "VFC stable" : `VFC ${hrvNow >= hrvBase ? "+" : "−"}${dec(Math.abs(hrvNow - hrvBase), 0)} ms`) : null,
    ].filter((x): x is string => x !== null).join(" · ");
    if (parts.length > 0) dimensions.push({
      label: "Récupération", score: clamp(mean(parts)), advice: "Protège tes nuits : c'est là que l'entraînement est absorbé.", detail: `${note}, comparé à tes 2 mois d'avant`, dots: null,
      how: "100 = 7 h 30 de sommeil, FC au repos et VFC au niveau de tes 2 mois d'avant. Moyenne des trois.",
    });
  }
  const fatigue = analysis.load[analysis.load.length - 1]?.fatigue ?? null;
  if (fatigue !== null && fatigue >= 7.5) findings.push({ good: false, title: "Fatigue élevée", text: `Ta semaine pèse beaucoup plus que ton mois habituel (fatigue ${dec(fatigue)} sur 10) : une semaine plus légère aiderait.` });

  const figures: Figure[] = [];
  if (weeklyKm !== null) figures.push({ label: "Volume moyen", value: `${dec(weeklyKm, 0)} km / sem.`, caption: weeklyRuns !== null ? `${dec(weeklyRuns)} sorties par semaine, sur 12 semaines` : null });
  const biggest = all.reduce<Week | null>((m, w) => (m === null || w.distance > m.distance ? w : m), null);
  if (biggest && biggest.distance > 0) figures.push({ label: "Semaine la plus chargée", value: `${dec(biggest.distance / 1000, 0)} km`, caption: `semaine du ${dayMonth(biggest.start)}` });
  const first = runs.reduce((m, a) => (a.startLocal < m ? a.startLocal : m), runs[0]!.startLocal).slice(0, 10);
  const totalKm = Math.round(runs.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000);
  const strengths = findings.filter((f) => f.good);
  const low = dimensions.reduce<Dimension | null>((m, d) => (m === null || d.score < m.score ? d : m), null);
  const weak = low && low.score < WEAK_BELOW ? low : null;
  // Ce que dit la page, c'est le présent : les dernières semaines, pas le total depuis la première sortie (celui-là va dans les chiffres clés).
  figures.push({ label: `Depuis ${monthName(first)} ${first.slice(0, 4)}`, value: `${totalKm} km`, caption: `${runs.length} sorties` });
  let summary = weeklyKm !== null && weeklyRuns !== null ? `Ces 12 dernières semaines : ${dec(weeklyKm, 0)} km et ${dec(weeklyRuns)} sorties par semaine.` : `Depuis ${monthName(first)} ${first.slice(0, 4)}, tu as couru ${totalKm} km en ${runs.length} sorties.`;
  if (strengths[0]) summary += ` Point fort du moment : ${strengths[0].title.charAt(0).toLowerCase()}${strengths[0].title.slice(1)}.`;
  if (weak) summary += ` À travailler : ${weak.label.toLowerCase()}.`;
  return { figures, dimensions, findings, summary };
}

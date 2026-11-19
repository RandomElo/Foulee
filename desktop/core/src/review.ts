// « À classer » : les sorties qui ressemblent à une compétition, trouvées par des règles simples (aucune supposition cachée) : portage de Review.list (Review.kt).
// Chaque critère rempli ajoute des points et s'affiche comme une raison. Une sortie est proposée dès REVIEW_SCORE points, jusqu'à ce qu'un type soit choisi à la main.
import { roundToInt } from "./format";
import { addDays } from "./dates";
import { detectedCategory, type Category } from "./categories";
import { isRun, type ActivityRow } from "./model";

export interface ReviewItem { activity: ActivityRow; detected: Category; score: number; reasons: string[] }

/** Ce que Strava dit de la même sortie (serveur maison) : ses labels, son titre et sa description. */
export interface StravaDit { name: string; description: string; labels: string[] }

const RACE_DISTANCES: [number, string][] = [[5000, "5 km"], [10_000, "10 km"], [15_000, "15 km"], [21_097, "semi-marathon"], [42_195, "marathon"]];
const DISTANCE_TOLERANCE = 0.03;
export const REVIEW_SCORE = 2.5;
const RACE_WORDS = /\b(semi|marathon|trail|cross|corrida|foul[ée]es?|course de|10 ?km|5 ?km|race|comp[ée]t\w*|chrono|run \d+)\b/i;
const DEFAULT_NAME = /course à pied/gi;

// FC moyenne d'une course en part de la FC max : plus basse sur un marathon que sur un 5 km.
const raceHrShare = (meters: number) => (meters >= 35_000 ? 0.8 : meters >= 18_000 ? 0.86 : 0.88);
const hasRaceWords = (text: string) => RACE_WORDS.test(text.replace(DEFAULT_NAME, ""));

/** La liste des sorties à vérifier, les plus récentes d'abord. `hrMax` est la FC max de l'athlète ; `stravaOf` donne ce que Strava dit d'une sortie, s'il le sait. */
export function reviewList(activities: ActivityRow[], hrMax: number, stravaOf: (a: ActivityRow) => StravaDit | null = () => null): ReviewItem[] {
  const runs = activities.filter(isRun).sort((a, b) => (a.startLocal < b.startLocal ? 1 : a.startLocal > b.startLocal ? -1 : 0));
  const items: ReviewItem[] = [];
  for (const a of runs) {
    if (a.manualCategory !== null || a.distance === null || a.averageSpeed === null) continue;
    const d = a.distance;
    const reasons: string[] = [];
    let score = 0;
    const official = RACE_DISTANCES.find(([m]) => Math.abs(d - m) / m <= DISTANCE_TOLERANCE);
    if (official) { score += 1; reasons.push(`Distance de course : ${official[1]}`); }
    if (a.averageHr !== null && a.averageHr >= hrMax * raceHrShare(d)) { score += 1; reasons.push(`FC moyenne ${roundToInt((a.averageHr / hrMax) * 100)} % de ta FC max`); }
    // Plus rapide que presque toutes les sorties de distance voisine (±20 %) des deux années d'avant.
    const from = addDays(a.startLocal.slice(0, 10), -730);
    const similar = runs.filter((o) => o !== a && o.distance !== null && o.averageSpeed !== null && Math.abs(o.distance - d) / d <= 0.2 && o.startLocal < a.startLocal && o.startLocal >= from);
    if (similar.length >= 10) {
      const slower = similar.filter((o) => (o.averageSpeed as number) < a.averageSpeed!).length / similar.length;
      if (slower >= 0.95) { score += 1.5; reasons.push(`Plus rapide que ${roundToInt(slower * 100)} % de tes sorties de cette distance`); }
    }
    // Les noms par défaut de Garmin (« Paris Course à pied ») ne disent rien : seuls les mots typiques d'une course comptent.
    const nameSaysRace = hasRaceWords(a.name);
    if (nameSaysRace) { score += 1.5; reasons.push(`Nom : « ${a.name} »`); }
    // Ce que Strava dit de la même sortie : ses propres labels et mots, un indice fort.
    const s = stravaOf(a) ?? (a.stravaLabels ? { name: "", description: "", labels: a.stravaLabels } : null);
    if (s) {
      if (s.labels.some((l) => l.toLowerCase() === "race")) { score += 2.5; reasons.push("Label Strava : Course"); }
      if (hasRaceWords(`${s.name} ${s.description}`) && !nameSaysRace) { score += 1.5; reasons.push(`Strava : « ${s.name} »`); }
    }
    const start = new Date(a.startLocal.replace(" ", "T"));
    const hour = start.getHours() + start.getMinutes() / 60;
    const weekend = start.getDay() === 0 || start.getDay() === 6;
    if (weekend && hour >= 7 && hour <= 11.5) { score += 0.5; reasons.push("Départ le week-end en matinée"); }
    if (score >= REVIEW_SCORE) items.push({ activity: a, detected: detectedCategory(a), score, reasons });
  }
  return items;
}


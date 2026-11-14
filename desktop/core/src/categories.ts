// Type de séance : portage de Categories.kt.
import { isRun, type ActivityRow } from "./model";

export const CATEGORIES = ["competition", "interval", "long", "easy", "strength", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const LONG_RUN_METERS = 19_000;
const STRENGTH_TYPES = ["strength_training", "indoor_cardio", "hiit"];

export function categoryLabel(category: string): string {
  switch (category) {
    case "competition": return "Compétition";
    case "interval": return "Fractionné";
    case "long": return "Sortie longue";
    case "easy": return "Footing";
    case "strength": return "Musculation";
    default: return "Autre sport";
  }
}

export function detectedCategory(a: ActivityRow): Category {
  if (STRENGTH_TYPES.includes(a.type)) return "strength";
  if (!a.type.includes("running")) return "other";
  if (a.intervalTitle !== null) return "interval";
  if (a.stravaLabels?.some((l) => l.toLowerCase() === "longrun")) return "long";
  if ((a.distance ?? 0) >= LONG_RUN_METERS) return "long";
  return "easy";
}

/** Un type choisi à la main gagne toujours sur la détection. */
export function categoryOf(a: ActivityRow): Category {
  const manual = a.manualCategory;
  return manual !== null && (CATEGORIES as readonly string[]).includes(manual) ? (manual as Category) : detectedCategory(a);
}

export { isRun };

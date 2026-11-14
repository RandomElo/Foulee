import type { Seance, StravaAct } from "../repo/types";

const TOLERANCE_DEBUT_S = 120;
const TOLERANCE_DUREE = 0.03;

const secondes = (local: string) => Date.parse(`${local.slice(0, 19)}Z`) / 1000;

/** L'activité Strava d'une séance de la montre : départ à 2 minutes près et durée à 3 % près (comme l'ancien serveur Strava). La plus proche si plusieurs. */
export function stravaDe(strava: StravaAct[], s: Seance): StravaAct | null {
  if (s.duration === null || s.duration <= 0) return null;
  const debut = secondes(s.startLocal);
  const candidats = strava
    .filter((a) => Math.abs(secondes(a.debutLocal) - debut) <= TOLERANCE_DEBUT_S && Math.abs(a.dureeTotaleS - s.duration!) <= s.duration! * TOLERANCE_DUREE)
    .sort((a, b) => Math.abs(secondes(a.debutLocal) - debut) - Math.abs(secondes(b.debutLocal) - debut));
  return candidats[0] ?? null;
}

const NOMS: Record<string, string> = { Race: "Course", Workout: "Entraînement", LongRun: "Sortie longue" };

/** Les labels de Strava dans les mots de l'appli. */
export const libelleLabel = (l: string): string => NOMS[l] ?? l;

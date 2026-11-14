import type { ActivityRow, DailyRow, Lap, LapRole, RoleOverrides } from "@foulee/core";

export interface Seance extends ActivityRow {
  source: string;
  /** Tours de la montre, dans l'ordre. */
  laps: Lap[];
  /** Rôles corrigés à la main, un par tour (null : pas de correction). */
  overrides: RoleOverrides;
}

/** Ressenti d'une séance : effort perçu (RPE 1 à 10), jambes (1 lourdes, 2 normales, 3 légères), douleur (0 aucune, 1 légère, 2 gênante). */
export interface Feeling {
  activityId: number;
  rpe: number | null;
  legs: number | null;
  pain: number | null;
  note: string;
  answeredAt: string;
}

/** Un élément du calendrier Nolio (lu par le navigateur piloté) : séance prévue ou réalisée, compétition, note. */
export interface NolioEvt {
  id: string;
  genre: "prevu" | "reel" | "note";
  competition: boolean;
  date: string;
  heure: string | null;
  titre: string;
  sport: string | null;
  dureeS: number | null;
  distanceM: number | null;
  denivM: number | null;
  allureSKm: number | null;
  /** Vrai quand l'allure prévue est une limite haute (footing : « pas plus vite que »), pas une allure à tenir. */
  allurePlafond: boolean;
  /** Effort estimé par le coach (séances prévues). */
  rpePrevu: number | null;
  ressenti: number | null;
  rpePercu: number | null;
  commentaire: string | null;
}

/** Une activité Strava (lue par le navigateur piloté) : nom, description et labels tels que Strava les affiche. */
export interface StravaAct {
  id: string;
  sport: string;
  nom: string;
  description: string;
  /** Labels gérés : LongRun, Race, Workout. */
  labels: string[];
  /** Heure de départ locale (comme les séances de la montre), « 2026-11-03T07:29:00 ». */
  debutLocal: string;
  dureeTotaleS: number;
}

export interface Donnees {
  seances: Seance[];
  daily: DailyRow[];
  feelings: Feeling[];
  nolio: NolioEvt[];
  strava: StravaAct[];
}

/** Tout ce que l'interface lit et écrit. Deux réalisations : la base chiffrée de Tauri, et une mémoire pour développer dans un navigateur. */
export interface Repo {
  load(): Promise<Donnees>;
  setRole(activityId: number, idx: number, role: LapRole | null): Promise<void>;
  clearRoles(activityId: number): Promise<void>;
  saveFeeling(f: Feeling): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Jeu de données de démonstration (développement seulement). Renvoie le nombre de séances. */
  loadDemo(): Promise<number>;
}

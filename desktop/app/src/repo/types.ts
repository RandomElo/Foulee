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

export interface Donnees {
  seances: Seance[];
  daily: DailyRow[];
  feelings: Feeling[];
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

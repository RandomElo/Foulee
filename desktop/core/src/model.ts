/** Une séance telle que la base la stocke (sous-ensemble utilisé par les calculs). */
export interface ActivityRow {
  id: number;
  /** « 2026-10-24 07:30:12 » */
  startLocal: string;
  type: string;
  distance: number | null;
  duration: number | null;
  averageSpeed: number | null;
  averageHr: number | null;
  maxHr: number | null;
  trainingLoad: number | null;
  name: string;
  elevation: number | null;
  intervalTitle: string | null;
  manualCategory: string | null;
  trimp: number | null;
  /** Étiquettes Strava de la même sortie, quand le serveur maison les a données. */
  stravaLabels: string[] | null;
  /** Température minimale relevée par la montre : absente tant que la lecture Garmin du PC ne la rapporte pas. */
  minTemperature?: number | null;
  /** Secondes passées dans chacune des 5 zones de FC : absent tant que la lecture Garmin du PC ne les rapporte pas. */
  hrZones?: number[] | null;
}

/** Une journée de santé. */
export interface DailyRow {
  date: string;
  restingHr: number | null;
  avgStress: number | null;
  bodyBatteryHigh: number | null;
  sleepSeconds: number | null;
  sleepScore: number | null;
  hrvNight: number | null;
  steps: number | null;
}

export const isRun = (a: ActivityRow): boolean => a.type.includes("running");
export const dayOf = (a: ActivityRow): string => a.startLocal.slice(0, 10);

export interface Sample {
  d: number | null;
  t: number | null;
  hr: number | null;
  speed: number | null;
  ele: number | null;
}

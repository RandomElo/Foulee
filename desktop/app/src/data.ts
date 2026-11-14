import { analyze, type ActivityRow, type DailyRow, type Lap, type LapRole, type RoleOverrides } from "@foulee/core";
import { batch, execute, select } from "./db";

type Ligne = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface Seance extends ActivityRow {
  source: string;
  /** Tours de la montre, dans l'ordre. */
  laps: Lap[];
  /** Rôles corrigés à la main, un par tour (null : pas de correction). */
  overrides: RoleOverrides;
}

export interface Donnees {
  seances: Seance[];
  daily: DailyRow[];
}

const lap = (r: Ligne): Lap => ({
  distance: num(r.distance), duration: num(r.duration), averageSpeed: num(r.avg_speed), averageHr: num(r.avg_hr), maxHr: num(r.max_hr),
  elevationGain: num(r.elevation_gain), intensityType: txt(r.intensity_type), stepIndex: num(r.step_index),
});

/** Charge tout (quelques milliers de séances au plus) et calcule les titres de fractionné avec les corrections de l'utilisateur. */
export async function charger(): Promise<Donnees> {
  const [acts, laps, roles, daily] = await Promise.all([
    select("SELECT * FROM activities ORDER BY start_local, id"),
    select("SELECT * FROM laps ORDER BY activity_id, idx"),
    select("SELECT activity_id, idx, role FROM lap_roles"),
    select("SELECT * FROM daily ORDER BY date"),
  ]);
  const lapsDe = new Map<number, Lap[]>();
  for (const r of laps) {
    const id = r.activity_id as number;
    lapsDe.set(id, [...(lapsDe.get(id) ?? []), lap(r)]);
  }
  const rolesDe = new Map<number, RoleOverrides>();
  for (const r of roles) {
    const id = r.activity_id as number;
    const o = rolesDe.get(id) ?? (lapsDe.get(id) ?? []).map(() => null);
    o[r.idx as number] = r.role as LapRole;
    rolesDe.set(id, o);
  }
  const seances = acts.map((a): Seance => {
    const id = a.id as number;
    const tours = lapsDe.get(id) ?? [];
    const overrides = rolesDe.get(id) ?? tours.map(() => null);
    const course = String(a.type).includes("running");
    const titre = course && tours.length > 0 ? analyze(tours, new Map(), overrides)?.title ?? null : null;
    return {
      id, source: String(a.source), startLocal: String(a.start_local), type: String(a.type), distance: num(a.distance), duration: num(a.duration),
      averageSpeed: num(a.avg_speed), averageHr: num(a.avg_hr), maxHr: num(a.max_hr), trainingLoad: num(a.training_load), name: String(a.name ?? ""),
      elevation: num(a.elevation), intervalTitle: titre, manualCategory: txt(a.manual_category), trimp: num(a.trimp), stravaLabels: null, laps: tours, overrides,
    };
  });
  return {
    seances,
    daily: daily.map((d): DailyRow => ({
      date: String(d.date), restingHr: num(d.resting_hr), avgStress: num(d.avg_stress), bodyBatteryHigh: num(d.body_battery_high),
      sleepSeconds: num(d.sleep_seconds), sleepScore: num(d.sleep_score), hrvNight: num(d.hrv_night), steps: num(d.steps),
    })),
  };
}

/** Enregistre (ou retire, avec null) la correction du rôle d'un tour. */
export async function corrigerRole(activityId: number, idx: number, role: LapRole | null): Promise<void> {
  if (role === null) await execute("DELETE FROM lap_roles WHERE activity_id = ? AND idx = ?", [activityId, idx]);
  else await execute("INSERT INTO lap_roles (activity_id, idx, role) VALUES (?, ?, ?) ON CONFLICT (activity_id, idx) DO UPDATE SET role = excluded.role", [activityId, idx, role]);
}

export async function effacerCorrections(activityId: number): Promise<void> {
  await execute("DELETE FROM lap_roles WHERE activity_id = ?", [activityId]);
}

/** Jeu de données de démonstration, pour développer sans compte : séances et nuits synthétiques du noyau, tours de séances types. Jamais en production. */
export async function chargerDemo(): Promise<number> {
  const [{ default: charge }, { default: synth }] = await Promise.all([import("../../core/fixtures/charge.json"), import("../../core/fixtures/synth.json")]);
  const jeu = (charge as unknown as { charge: { activities: Ligne[]; daily: Ligne[] }[] }).charge[0];
  if (!jeu) return 0;
  const modeles = (synth as unknown as { mode: string; seed: number; laps: Lap[] }[]).filter((c) => c.mode === "manual" && c.seed === 1);
  const lot: { sql: string; params: (string | number | null)[] }[] = [];
  let k = 0;
  jeu.activities.forEach((a, i) => {
    const interval = typeof a.intervalTitle === "string";
    lot.push({
      sql: "INSERT OR IGNORE INTO activities (id, source, external_id, start_local, type, distance, duration, avg_speed, avg_hr, max_hr, training_load, name, elevation, manual_category, trimp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      params: [i + 1, "demo", String(a.id), a.startLocal as string, a.type as string, num(a.distance), num(a.duration), num(a.averageSpeed), num(a.averageHr), num(a.maxHr), num(a.trainingLoad), `Séance ${i + 1}`, num(a.elevation), txt(a.manualCategory), num(a.trimp)],
    });
    if (interval) {
      const modele = modeles[k++ % modeles.length];
      modele?.laps.forEach((l, idx) => lot.push({
        sql: "INSERT OR IGNORE INTO laps (activity_id, idx, distance, duration, avg_speed, avg_hr, max_hr, elevation_gain, intensity_type, step_index) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params: [i + 1, idx, l.distance, l.duration, l.averageSpeed, l.averageHr, l.maxHr, l.elevationGain, l.intensityType, l.stepIndex],
      }));
    }
  });
  for (const d of jeu.daily) {
    lot.push({
      sql: "INSERT OR IGNORE INTO daily (date, resting_hr, avg_stress, body_battery_high, sleep_seconds, sleep_score, hrv_night, steps) VALUES (?,?,?,?,?,?,?,?)",
      params: [d.date as string, num(d.restingHr), num(d.avgStress), num(d.bodyBatteryHigh), num(d.sleepSeconds), num(d.sleepScore), num(d.hrvNight), num(d.steps)],
    });
  }
  for (let i = 0; i < lot.length; i += 400) await batch(lot.slice(i, i + 400));
  return jeu.activities.length;
}

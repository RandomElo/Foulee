import { batch, execute, select } from "../db";
import type { DailyRow, Lap, LapRole, RoleOverrides } from "@foulee/core";
import { toSeance } from "./enrich";
import { localToday } from "../lib/format";
import type { Donnees, Feeling, NolioEvt, Repo, Seance } from "./types";

type Ligne = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

const lap = (r: Ligne): Lap => ({
  distance: num(r.distance), duration: num(r.duration), averageSpeed: num(r.avg_speed), averageHr: num(r.avg_hr), maxHr: num(r.max_hr),
  elevationGain: num(r.elevation_gain), intensityType: txt(r.intensity_type), stepIndex: num(r.step_index),
});

export const tauriRepo: Repo = {
  async load(): Promise<Donnees> {
    const [acts, laps, roles, daily, feel, nolio] = await Promise.all([
      select("SELECT * FROM activities ORDER BY start_local, id"),
      select("SELECT * FROM laps ORDER BY activity_id, idx"),
      select("SELECT activity_id, idx, role FROM lap_roles"),
      select("SELECT * FROM daily ORDER BY date"),
      select("SELECT * FROM feelings"),
      select("SELECT * FROM nolio_evenements ORDER BY date, heure, id"),
    ]);
    const lapsDe = new Map<number, Lap[]>();
    for (const r of laps) lapsDe.set(r.activity_id as number, [...(lapsDe.get(r.activity_id as number) ?? []), lap(r)]);
    const rolesDe = new Map<number, RoleOverrides>();
    for (const r of roles) {
      const id = r.activity_id as number;
      const o = rolesDe.get(id) ?? (lapsDe.get(id) ?? []).map(() => null);
      o[r.idx as number] = r.role as LapRole;
      rolesDe.set(id, o);
    }
    const seances = acts.map((a): Seance => toSeance({
      id: a.id as number, source: String(a.source), startLocal: String(a.start_local), type: String(a.type), distance: num(a.distance), duration: num(a.duration),
      averageSpeed: num(a.avg_speed), averageHr: num(a.avg_hr), maxHr: num(a.max_hr), trainingLoad: num(a.training_load), name: String(a.name ?? ""), elevation: num(a.elevation),
      manualCategory: txt(a.manual_category), trimp: num(a.trimp), stravaLabels: null,
    }, lapsDe.get(a.id as number) ?? [], rolesDe.get(a.id as number)));
    return {
      seances,
      daily: daily.map((d): DailyRow => ({
        date: String(d.date), restingHr: num(d.resting_hr), avgStress: num(d.avg_stress), bodyBatteryHigh: num(d.body_battery_high),
        sleepSeconds: num(d.sleep_seconds), sleepScore: num(d.sleep_score), hrvNight: num(d.hrv_night), steps: num(d.steps),
      })),
      nolio: nolio.map((n): NolioEvt => ({
        id: String(n.id), genre: n.genre as NolioEvt["genre"], competition: n.competition === 1, date: String(n.date), heure: txt(n.heure), titre: String(n.titre ?? ""),
        sport: txt(n.sport), dureeS: num(n.duree_s), distanceM: num(n.distance_m), denivM: num(n.deniv_m), allureSKm: num(n.allure_s_km), allurePlafond: n.allure_plafond === 1,
        rpePrevu: num(n.rpe_prevu), ressenti: num(n.ressenti), rpePercu: num(n.rpe_percu), commentaire: txt(n.commentaire),
      })),
      feelings: feel.map((f): Feeling => ({ activityId: f.activity_id as number, rpe: num(f.rpe), legs: num(f.legs), pain: num(f.pain), note: txt(f.note) ?? "", answeredAt: String(f.answered_at) })),
    };
  },

  async setRole(activityId, idx, role) {
    if (role === null) await execute("DELETE FROM lap_roles WHERE activity_id = ? AND idx = ?", [activityId, idx]);
    else await execute("INSERT INTO lap_roles (activity_id, idx, role) VALUES (?, ?, ?) ON CONFLICT (activity_id, idx) DO UPDATE SET role = excluded.role", [activityId, idx, role]);
  },
  async clearRoles(activityId) {
    await execute("DELETE FROM lap_roles WHERE activity_id = ?", [activityId]);
  },
  async saveFeeling(f) {
    await execute(
      "INSERT INTO feelings (activity_id, rpe, legs, pain, note, answered_at) VALUES (?,?,?,?,?,?) ON CONFLICT (activity_id) DO UPDATE SET rpe = excluded.rpe, legs = excluded.legs, pain = excluded.pain, note = excluded.note, answered_at = excluded.answered_at",
      [f.activityId, f.rpe, f.legs, f.pain, f.note, f.answeredAt],
    );
  },
  async getSetting(key) {
    const r = await select("SELECT valeur FROM reglages WHERE cle = ?", [key]);
    return r[0] ? String(r[0].valeur) : null;
  },
  async setSetting(key, value) {
    await execute("INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur", [key, value]);
  },
  async loadDemo() {
    // Les données de démonstration n'existent que dans les builds de développement (le bloc disparaît du build final).
    if (!import.meta.env.DEV) return 0;
    const { buildDemo } = await import("./demo");
    const { activities, daily, feelings } = await buildDemo(localToday());
    const lot: { sql: string; params: (string | number | null)[] }[] = [];
    for (const a of activities) {
      lot.push({
        sql: "INSERT OR IGNORE INTO activities (id, source, external_id, start_local, type, distance, duration, avg_speed, avg_hr, max_hr, training_load, name, elevation, manual_category, trimp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params: [a.id, "demo", String(a.id), a.startLocal, a.type, a.distance, a.duration, a.averageSpeed, a.averageHr, a.maxHr, a.trainingLoad, a.name, a.elevation, a.manualCategory, a.trimp],
      });
      a.laps.forEach((l, idx) => lot.push({
        sql: "INSERT OR IGNORE INTO laps (activity_id, idx, distance, duration, avg_speed, avg_hr, max_hr, elevation_gain, intensity_type, step_index) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params: [a.id, idx, l.distance, l.duration, l.averageSpeed, l.averageHr, l.maxHr, l.elevationGain, l.intensityType, l.stepIndex],
      }));
    }
    for (const d of daily) lot.push({
      sql: "INSERT OR IGNORE INTO daily (date, resting_hr, avg_stress, body_battery_high, sleep_seconds, sleep_score, hrv_night, steps) VALUES (?,?,?,?,?,?,?,?)",
      params: [d.date, d.restingHr, d.avgStress, d.bodyBatteryHigh, d.sleepSeconds, d.sleepScore, d.hrvNight, d.steps],
    });
    for (const f of feelings) lot.push({
      sql: "INSERT OR IGNORE INTO feelings (activity_id, rpe, legs, pain, note, answered_at) VALUES (?,?,?,?,?,?)",
      params: [f.activityId, f.rpe, f.legs, f.pain, f.note, f.answeredAt],
    });
    for (let i = 0; i < lot.length; i += 400) await batch(lot.slice(i, i + 400));
    return activities.length;
  },
};

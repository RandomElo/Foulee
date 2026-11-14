import type { DailyRow, LapRole, RoleOverrides } from "@foulee/core";
import { applyOverride, toSeance } from "./enrich";
import { localToday } from "../lib/format";
import type { Donnees, Feeling, Repo } from "./types";

/**
 * Réalisation en mémoire pour développer et tester l'interface dans un navigateur, hors Tauri : même contrat que la base chiffrée,
 * données de démonstration chargées au premier accès, rien n'est conservé au rechargement de la page.
 */
export function createMemoryRepo(): Repo {
  let ready: Promise<void> | null = null;
  let seances: Donnees["seances"] = [];
  let daily: DailyRow[] = [];
  let feelings: Feeling[] = [];
  const settings = new Map<string, string>();
  const roles = new Map<number, RoleOverrides>();

  const demo = async () => {
    const { buildDemo } = await import("./demo");
    const d = await buildDemo(localToday());
    seances = d.activities.map((a) => toSeance({ ...a, source: "demo", stravaLabels: null }, a.laps, roles.get(a.id)));
    daily = d.daily;
    feelings = d.feelings;
    return seances.length;
  };
  const init = () => (ready ??= demo().then(() => undefined));
  const refresh = () => { seances = seances.map((s) => toSeance(s, s.laps, roles.get(s.id))); };

  return {
    async load() { await init(); return { seances, daily, feelings }; },
    async setRole(id, idx, role: LapRole | null) {
      const s = seances.find((x) => x.id === id);
      if (!s) return;
      roles.set(id, applyOverride(roles.get(id), s.laps.length, idx, role));
      refresh();
    },
    async clearRoles(id) { roles.delete(id); refresh(); },
    async saveFeeling(f) { feelings = [...feelings.filter((x) => x.activityId !== f.activityId), f]; },
    async getSetting(k) { return settings.get(k) ?? null; },
    async setSetting(k, v) { settings.set(k, v); },
    async loadDemo() { await init(); return seances.length; },
  };
}

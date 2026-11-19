import type { DailyRow, LapRole, RoleOverrides } from "@foulee/core";
import { applyOverride, toSeance } from "./enrich";
import { localToday } from "../lib/format";
import { demoNolio } from "./demoNolio";
import type { Donnees, Feeling, NolioEvt, Repo, StravaAct } from "./types";

/**
 * Réalisation en mémoire pour développer et tester l'interface dans un navigateur, hors Tauri : même contrat que la base chiffrée,
 * données de démonstration chargées au premier accès, rien n'est conservé au rechargement de la page.
 */
export function createMemoryRepo(): Repo {
  let ready: Promise<void> | null = null;
  let seances: Donnees["seances"] = [];
  let daily: DailyRow[] = [];
  let feelings: Feeling[] = [];
  let nolio: NolioEvt[] = [];
  let strava: StravaAct[] = [];
  const settings = new Map<string, string>();
  const roles = new Map<number, RoleOverrides>();

  const demo = async () => {
    const { buildDemo } = await import("./demo");
    const d = await buildDemo(localToday());
    seances = d.activities.map((a) => toSeance({ ...a, source: "demo", stravaLabels: null }, a.laps, roles.get(a.id)));
    daily = d.daily;
    feelings = d.feelings;
    strava = seances.slice(-3).map((s, i) => ({ id: `demo-${i}`, sport: "Run", nom: i === 2 ? "Semi de démonstration" : "Footing du matin", description: i === 0 ? "Bonnes jambes, rien à signaler." : "", labels: i === 2 ? ["Race"] : i === 1 ? ["LongRun"] : [], debutLocal: s.startLocal, dureeTotaleS: Math.round(s.duration ?? 0) }));
    nolio = demoNolio(localToday(), seances.map((s) => s.startLocal.slice(0, 10)));
    return seances.length;
  };
  const init = () => (ready ??= demo().then(() => undefined));
  const refresh = () => { seances = seances.map((s) => toSeance(s, s.laps, roles.get(s.id))); };

  return {
    async load() { await init(); return { seances, daily, feelings, nolio, strava }; },
    async setRole(id, idx, role: LapRole | null) {
      const s = seances.find((x) => x.id === id);
      if (!s) return;
      roles.set(id, applyOverride(roles.get(id), s.laps.length, idx, role));
      refresh();
    },
    async clearRoles(id) { roles.delete(id); refresh(); },
    async setCategory(id, category) { seances = seances.map((s) => (s.id === id ? { ...s, manualCategory: category } : s)); },
    async saveFeeling(f) { feelings = [...feelings.filter((x) => x.activityId !== f.activityId), f]; },
    async getSetting(k) { return settings.get(k) ?? null; },
    async setSetting(k, v) { settings.set(k, v); },
    async resetAll() { seances = []; roles.clear(); feelings = []; settings.clear(); },
    async loadDemo() { await init(); return seances.length; },
  };
}

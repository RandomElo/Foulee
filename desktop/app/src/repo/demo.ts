import type { DailyRow, Lap } from "@foulee/core";
import { addDays, daysBetween, categoryLabel, categoryOf } from "@foulee/core";
import type { Feeling } from "./types";

export interface DemoActivity {
  id: number; startLocal: string; type: string; distance: number | null; duration: number | null; averageSpeed: number | null; averageHr: number | null; maxHr: number | null;
  trainingLoad: number | null; name: string; elevation: number | null; manualCategory: string | null; trimp: number | null; laps: Lap[];
}

type Ligne = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Jeu synthétique du noyau, décalé pour que la dernière journée soit aujourd'hui, avec des tours de séances types et quelques ressentis. */
export async function buildDemo(today: string): Promise<{ activities: DemoActivity[]; daily: DailyRow[]; feelings: Feeling[] }> {
  const [{ default: charge }, { default: synth }] = await Promise.all([import("../../../core/fixtures/charge.json"), import("../../../core/fixtures/synth.json")]);
  const jeu = (charge as unknown as { today: string; charge: { today: string; activities: Ligne[]; daily: Ligne[] }[] }).charge[0];
  if (!jeu) return { activities: [], daily: [], feelings: [] };
  const shift = daysBetween(jeu.today, today);
  const modeles = (synth as unknown as { mode: string; seed: number; laps: Lap[] }[]).filter((c) => c.mode === "manual" && c.seed === 1);
  const dec = (iso: string) => addDays(iso, shift);
  let k = 0;
  const activities: DemoActivity[] = jeu.activities.map((a, i) => {
    const start = `${dec((a.startLocal as string).slice(0, 10))}${(a.startLocal as string).slice(10)}`;
    const interval = typeof a.intervalTitle === "string";
    const base = {
      id: i + 1, startLocal: start, type: a.type as string, distance: num(a.distance), duration: num(a.duration), averageSpeed: num(a.averageSpeed), averageHr: num(a.averageHr),
      maxHr: num(a.maxHr), trainingLoad: num(a.trainingLoad), name: "", elevation: num(a.elevation), manualCategory: txt(a.manualCategory), trimp: num(a.trimp),
    };
    const row = { ...base, intervalTitle: null, stravaLabels: null };
    return { ...base, name: categoryLabel(categoryOf(row)), laps: interval ? (modeles[k++ % modeles.length]?.laps ?? []) : [] };
  });
  const daily: DailyRow[] = jeu.daily.map((d) => ({
    date: dec(d.date as string), restingHr: num(d.restingHr), avgStress: num(d.avgStress), bodyBatteryHigh: num(d.bodyBatteryHigh), sleepSeconds: num(d.sleepSeconds),
    sleepScore: num(d.sleepScore), hrvNight: num(d.hrvNight), steps: num(d.steps),
  }));
  // Un ressenti sur trois séances récentes, pour que l'accueil ait quelque chose à montrer.
  const feelings: Feeling[] = activities.slice(-14).filter((_, i) => i % 3 === 0).map((a, i) => ({
    activityId: a.id, rpe: [5, 7, 3, 6, 8][i % 5] as number, legs: 2, pain: 0, note: "", answeredAt: a.startLocal,
  }));
  return { activities, daily, feelings };
}

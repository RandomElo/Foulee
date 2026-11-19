import { describe, expect, it } from "vitest";
import { addDays, analyzeLoad, healthSummary, hours, shortDuration, type ActivityRow, type DailyRow } from "./index";

const AUJOURDHUI = "2026-11-14";
const jours = Array.from({ length: 90 }, (_, i) => addDays(AUJOURDHUI, i - 89));
const daily = (sommeilH: number, vfc: number): DailyRow[] =>
  jours.map((date, i) => ({ date, restingHr: 48 + (i % 3), avgStress: 30, bodyBatteryHigh: 80, sleepSeconds: sommeilH * 3600, sleepScore: 80, hrvNight: vfc + (i % 5), steps: 9000 }));
const run = (id: number, date: string): ActivityRow => ({
  id, startLocal: `${date} 08:00:00`, type: "running", distance: 10000, duration: 3000, averageSpeed: 3.3, averageHr: 145, maxHr: 165,
  trainingLoad: null, name: "", elevation: null, intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null,
});
const footings = jours.filter((_, i) => i % 2 === 0).map((d, i) => run(i + 1, d));

describe("indicateurs de santé", () => {
  it("donne les cinq indicateurs avec assez de données", () => {
    const d = daily(7.8, 60);
    const m = healthSummary(30, footings, d, analyzeLoad(footings, d, AUJOURDHUI), AUJOURDHUI);
    expect(m.map((x) => x.key)).toEqual(["recovery", "sleep", "hrv", "fitness", "fatigue"]);
    const sommeil = m.find((x) => x.key === "sleep")!;
    expect(sommeil.status).toBe("good");
    expect(sommeil.value).toBe("7 h 48");
    expect(sommeil.delta).toBe("comme d'habitude");
    expect(sommeil.series).toHaveLength(30);
    const vfc = m.find((x) => x.key === "hrv")!;
    expect(vfc.band).toBeDefined();
    expect(vfc.status).toBe("normal");
    expect(m.find((x) => x.key === "fitness")!.unit).toBe("/km à 150 bpm");
  });
  it("un sommeil court est « Insuffisant » et une VFC effondrée est sous la norme", () => {
    const d = daily(7.8, 60).map((x, i) => (i >= 83 ? { ...x, sleepSeconds: 5.5 * 3600, hrvNight: 35 } : x));
    const m = healthSummary(30, footings, d, analyzeLoad(footings, d, AUJOURDHUI), AUJOURDHUI);
    expect(m.find((x) => x.key === "sleep")!.statusLabel).toBe("Insuffisant");
    expect(m.find((x) => x.key === "hrv")!.status).toBe("low");
  });
  it("sans données, aucun indicateur ne s'invente", () => {
    expect(healthSummary(30, [], [], analyzeLoad([], [], AUJOURDHUI), AUJOURDHUI)).toEqual([]);
  });
  it("formats d'heures", () => {
    expect(hours(7 * 3600 + 5 * 60)).toBe("7 h 05");
    expect(shortDuration(-45 * 60)).toBe("45 min");
    expect(shortDuration(70 * 60)).toBe("1 h 10");
  });
});

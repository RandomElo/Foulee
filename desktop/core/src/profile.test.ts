import { describe, expect, it } from "vitest";
import { addDays, analyzeLoad, computeProfile, weakest, type ActivityRow, type DailyRow } from "./index";

const AUJOURDHUI = "2026-11-14"; // samedi
const run = (id: number, date: string, km: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id, startLocal: `${date} 08:00:00`, type: "running", distance: km * 1000, duration: km * 330, averageSpeed: 3.0, averageHr: 148, maxHr: 170, trainingLoad: null, name: "", elevation: null,
  intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null, ...extra,
});
/** Quatre sorties par semaine pendant 14 semaines, dont un fractionné toutes les deux semaines. */
const activites: ActivityRow[] = Array.from({ length: 14 }, (_, w) => [0, 2, 4, 5].map((d, k) => run(w * 4 + k + 1, addDays("2026-08-10", w * 7 + d), 10, k === 1 && w % 2 === 0 ? { intervalTitle: "6 × 1000 m", manualCategory: "interval" } : {}))).flat().filter((a) => a.startLocal.slice(0, 10) <= AUJOURDHUI);
const daily = (sommeilH: number, vfc: number): DailyRow[] => Array.from({ length: 90 }, (_, i) => ({ date: addDays(AUJOURDHUI, i - 89), restingHr: 50, avgStress: 30, bodyBatteryHigh: 80, sleepSeconds: sommeilH * 3600, sleepScore: 80, hrvNight: vfc, steps: 9000 }));

describe("profil du coureur", () => {
  it("sans course : rien", () => {
    expect(computeProfile([], [], analyzeLoad([], [], AUJOURDHUI), AUJOURDHUI)).toEqual({ figures: [], dimensions: [], findings: [], summary: null });
  });
  it("régularité, volume, dosage et chiffres clés", () => {
    const d = daily(7.8, 60);
    const p = computeProfile(activites, d, analyzeLoad(activites, d, AUJOURDHUI), AUJOURDHUI);
    const note = (l: string) => p.dimensions.find((x) => x.label === l);
    expect(note("Régularité")?.score).toBe(100);
    expect(note("Régularité")?.dots).toEqual([12, 12]);
    expect(note("Vitesse")?.score).toBe(Math.round((p.dimensions.find((x) => x.label === "Vitesse")!.dots![0] * 100) / 6));
    expect(p.findings.some((f) => f.good && f.title === "Régularité")).toBe(true);
    expect(p.findings.some((f) => f.good && f.title === "Sommeil suffisant")).toBe(true);
    expect(p.figures[0]?.label).toBe("Volume moyen");
    expect(p.figures[0]?.value).toBe("40 km / sem.");
    expect(p.summary).toContain("Ces 12 dernières semaines : 40 km et 4 sorties par semaine.");
  });
  it("un sommeil court, une VFC qui chute et un point faible bien bas", () => {
    const d = daily(7.8, 60).map((x, i) => (i >= 76 ? { ...x, sleepSeconds: 6 * 3600, hrvNight: 45 } : x));
    const sansLongues = activites.map((a) => ({ ...a, duration: 3000 }));
    const p = computeProfile(sansLongues, d, analyzeLoad(sansLongues, d, AUJOURDHUI), AUJOURDHUI);
    expect(p.findings.some((f) => !f.good && f.title === "Sommeil court")).toBe(true);
    expect(p.findings.some((f) => !f.good && f.title === "VFC en baisse")).toBe(true);
    expect(p.findings.some((f) => !f.good && f.title === "Pas de sortie longue")).toBe(true);
    expect(weakest(p)?.label).toBe("Endurance");
    expect(p.summary).toContain("À travailler : endurance.");
  });
});

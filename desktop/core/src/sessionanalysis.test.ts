import { describe, expect, it } from "vitest";
import { addDays, analyzeLoad, SessionHistory, seedOf, pick, sessionRemark, type ActivityRow, type DailyRow, type Lap } from "./index";

const lap = (distance: number, duration: number, intensityType: string, hr = 165): Lap => ({ distance, duration, averageSpeed: distance / duration, averageHr: hr, maxHr: hr + 8, elevationGain: 0, intensityType, stepIndex: null });
/** 2 km d'échauffement, 6 × 1000 m à `secondes` s chacun (récup 200 m en 90 s), retour au calme. */
const laps = (secondes: number[]): Lap[] => [lap(2000, 600, "WARMUP", 130), ...secondes.flatMap((s) => [lap(1000, s, "ACTIVE"), lap(200, 90, "RECOVERY", 140)]), lap(1500, 450, "COOLDOWN", 130)];

const AUJOURDHUI = "2026-11-14";
const jours = Array.from({ length: 200 }, (_, i) => addDays(AUJOURDHUI, i - 199));
const daily: DailyRow[] = jours.map((date, i) => ({ date, restingHr: 48 + (i % 3), avgStress: 30, bodyBatteryHigh: 80, sleepSeconds: (7 + (i % 4) * 0.3) * 3600, sleepScore: 80, hrvNight: 60 + (i % 5), steps: 9000 }));
const seance = (id: number, date: string): ActivityRow => ({
  id, startLocal: `${date} 08:00:00`, type: "running", distance: 10000, duration: 3300, averageSpeed: 3.0, averageHr: 155, maxHr: 178, trainingLoad: null, name: "", elevation: null,
  intervalTitle: "6 × 1000 m", manualCategory: null, trimp: null, stravaLabels: null,
});
// 14 séances toutes les semaines, la dernière nettement plus lente et qui s'écroule en fin de série.
const dates = Array.from({ length: 14 }, (_, i) => addDays("2026-08-10", i * 7));
const activites = dates.map((d, i) => seance(i + 1, d));
const lapsById = new Map<number, Lap[]>(activites.map((a, i) => [a.id, i === 13 ? laps([205, 207, 212, 222, 228, 235]) : laps([200 + (i % 3), 201, 200, 202, 201, 200 + (i % 2)])]));
const refs = { vma: 19.2, rec5: 1008, rec10: 2222, recHalf: 5028 };
const historique = () => new SessionHistory(activites, lapsById, analyzeLoad(activites, daily, AUJOURDHUI), refs);

describe("graine et formulations", () => {
  it("la graine est celle du Kotlin (hachage de 31) et pick est stable", () => {
    expect(seedOf(123)).toBe(48690);
    expect(seedOf("abc")).toBe(96354);
    expect(pick(5, ["a", "b", "c"])).toBe(pick(5, ["a", "b", "c"]));
    expect(["a", "b", "c"]).toContain(pick(48690, ["a", "b", "c"]));
  });
});

describe("analyse d'une séance de fractionné", () => {
  it("compare aux séances passées et repère la séance lente qui s'écroule", () => {
    const h = historique();
    const a = h.analyze(14, [], lapsById.get(14) as Lap[]);
    expect(a).not.toBeNull();
    expect(["below", "hard"]).toContain(a!.verdict);
    expect(a!.paceIndex).toBeLessThan(-2);
    expect(a!.fadePct).toBeLessThan(-4);
    expect(a!.reps).toHaveLength(6);
    expect(a!.reps[0]?.reference).not.toBeNull();
    expect(a!.score).not.toBeNull();
    expect(a!.score as number).toBeGreaterThanOrEqual(0);
    expect(a!.score as number).toBeLessThanOrEqual(10);
    expect(a!.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(a!.summary).toMatch(/6 × 1000.m à 3:38\/km/);
    const remarque = sessionRemark(a);
    expect(remarque).toContain("Tu as trop ralenti à la fin");
    expect(remarque).toMatch(/\d{2} \/ km/);
  });
  it("une séance régulière dans la norme n'a pas de remarque", () => {
    const a = historique().analyze(8, [], lapsById.get(8) as Lap[]);
    expect(a).not.toBeNull();
    expect(["standard", "good", "excellent"]).toContain(a!.verdict);
    expect(sessionRemark(a)).toBeNull();
  });
  it("la première séance sert de référence, un footing ou un id inconnu ne donne rien", () => {
    const h = historique();
    const premiere = h.analyze(1, [], lapsById.get(1) as Lap[]);
    expect(premiere?.verdict).toBe("first");
    expect(premiere?.paceIndex).toBeNull();
    expect(h.analyze(999, [], [])).toBeNull();
    expect(h.noteOf(999)).toBeNull();
    expect(h.noteOf(14)?.remark).toContain("ralenti");
    expect(h.latest()?.id).toBe(14);
  });
  it("sans références, la note reste calculable (intensité à l'allure impossible à juger écartée)", () => {
    const h = new SessionHistory(activites, lapsById, analyzeLoad(activites, daily, AUJOURDHUI), { vma: 0, rec5: 0, rec10: 0, recHalf: 0 });
    const a = h.analyze(8, [], lapsById.get(8) as Lap[]);
    expect(a?.score).not.toBeNull();
  });
});

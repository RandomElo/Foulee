import { describe, expect, it } from "vitest";
import { analyze, buildEasy, buildInterval, figures, plain, proposedSpeciality, racePaces, type ActivityRow, type Lap } from "./index";

const lap = (distance: number, duration: number, intensityType: string): Lap => ({
  distance, duration, averageSpeed: distance / duration, averageHr: 150, maxHr: 170, elevationGain: 0, intensityType, stepIndex: null,
});
/** 2 km d'échauffement, 6 × 1000 m à 3 min 21 avec 200 m de récupération, retour au calme. */
const seance = (): Lap[] => [lap(2000, 600, "WARMUP"), ...Array.from({ length: 6 }, () => [lap(1000, 201, "ACTIVE"), lap(200, 90, "RECOVERY")]).flat(), lap(1500, 450, "COOLDOWN")];
const refs = { vma: 19.2, rec5: 16 * 60 + 48, rec10: 37 * 60 + 2, recHalf: 3600 + 23 * 60 + 48 };

describe("allures de course", () => {
  it("5 km, 10 km, semi et marathon (Riegel) à partir des records", () => {
    const p = racePaces(refs);
    expect(p.map((x) => x[0])).toEqual(["5 km", "10 km", "semi", "marathon"]);
    expect(p[0]?.[1]).toBeCloseTo(201.6, 5);
    expect(p[2]?.[1]).toBeCloseTo(5028 / 21.0975, 5);
    expect(racePaces({ ...refs, rec5: 0, rec10: 0, recHalf: 0 })).toEqual([]);
  });
});

describe("titre Spé et texte Strava", () => {
  const a = analyze(seance());
  it("propose 5 km quand les répétitions courent à l'allure du record, rien sans références", () => {
    expect(a).not.toBeNull();
    expect(proposedSpeciality(a!, refs)).toBe("5 km");
    expect(proposedSpeciality(a!, { ...refs, rec5: 0, rec10: 0, recHalf: 0 })).toBeNull();
    expect(proposedSpeciality(a!, { ...refs, rec5: 20 * 60, rec10: 0, recHalf: 0 })).toBeNull();
  });
  it("écrit le nom, une ligne par effort, la charge et la signature", () => {
    const t = buildInterval(a!, 14.9, null, "5 km");
    expect(t.name).toMatch(/^Spé 5 km - 6 x 1000 m \( r : 1 min 30 \)$/);
    expect(t.description.split("\n")).toEqual(["1000 m : 3 min 21 / km", "Charge 14,9/20 (Progression)", "🤖 Généré par Foulée"]);
    expect(buildInterval(a!, null, null, null).name.startsWith("Fractionné - ")).toBe(true);
    expect(buildInterval(a!, null, null, "none").name.startsWith("Fractionné - ")).toBe(true);
  });
});

describe("footing et détails", () => {
  const run: ActivityRow = { id: 1, startLocal: "2026-11-14 08:00:00", type: "running", distance: 10000, duration: 3000, averageSpeed: 3.3, averageHr: 140, maxHr: 160, trainingLoad: null, name: "", elevation: null, intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null };
  it("footing et sortie longue", () => {
    expect(buildEasy(run, "easy", 8)?.name).toBe("Footing");
    expect(buildEasy(run, "long", 8)?.name).toBe("Sortie longue");
    expect(buildEasy(run, "easy", 8)?.interval).toBe(false);
    expect(buildEasy({ ...run, distance: 0 }, "easy", 8)).toBeNull();
  });
  it("chiffre de charge et écriture simple", () => {
    expect(figures(null)).toBeNull();
    expect(figures(4)).toBe("Charge 4/20 (Sous-entraînement)");
    expect(plain("5 × 200 m 30 s")).toBe("5 x 200 m 30 sec");
  });
});

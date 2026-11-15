import { describe, expect, it } from "vitest";
import { sessionsOfDay, type ActivityRow } from "./index";

const run = (id: number, heure: string, minutes: number, manualCategory: string | null = null): ActivityRow => ({
  id, startLocal: `2026-11-14 ${heure}:00`, type: "running", distance: minutes * 200, duration: minutes * 60, averageSpeed: 3.3, averageHr: 150, maxHr: 170,
  trainingLoad: null, name: "", elevation: null, intervalTitle: null, manualCategory, trimp: null, stravaLabels: null,
});

describe("séances du jour", () => {
  it("un échauffement et un retour au calme autour d'un fractionné n'en font qu'une", () => {
    expect(sessionsOfDay([run(1, "08:00", 15), run(2, "08:20", 30, "interval"), run(3, "08:55", 10)])).toBe(1);
  });
  it("même règle autour d'une compétition (catégorie « competition »)", () => {
    expect(sessionsOfDay([run(1, "08:00", 15), run(2, "08:20", 30, "competition"), run(3, "08:55", 10)])).toBe(1);
  });
  it("deux footings sans séance dure restent deux séances", () => {
    expect(sessionsOfDay([run(1, "08:00", 15), run(2, "08:20", 30)])).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import type { Seance, StravaAct } from "../repo/types";
import { libelleLabel, stravaDe } from "./strava";

const a = (id: string, debutLocal: string, dureeTotaleS: number): StravaAct => ({ id, sport: "Run", nom: id, description: "", labels: [], debutLocal, dureeTotaleS });
const seance = (startLocal: string, duration: number | null) => ({ startLocal, duration } as unknown as Seance);

describe("rapprochement Strava", () => {
  const liste = [a("pile", "2026-11-03T07:29:00", 3000), a("proche", "2026-11-03T07:30:30", 3010), a("loin", "2026-11-03T07:40:00", 3000), a("autre-duree", "2026-11-03T07:29:00", 4000)];
  it("prend l'activité au même départ et à la même durée", () => {
    expect(stravaDe(liste, seance("2026-11-03T07:29:00", 3000))?.id).toBe("pile");
  });
  it("tolère 2 minutes de départ et 3 % de durée, et prend la plus proche", () => {
    expect(stravaDe(liste, seance("2026-11-03T07:30:10", 3000))?.id).toBe("proche");
    expect(stravaDe([a("x", "2026-11-03T07:29:00", 3000)], seance("2026-11-03T07:31:00", 3000))?.id).toBe("x");
    expect(stravaDe([a("x", "2026-11-03T07:29:00", 3000)], seance("2026-11-03T07:31:01", 3000))).toBeNull();
    expect(stravaDe([a("x", "2026-11-03T07:29:00", 3000)], seance("2026-11-03T07:29:00", 3090))?.id).toBe("x");
    expect(stravaDe([a("x", "2026-11-03T07:29:00", 3000)], seance("2026-11-03T07:29:00", 3100))).toBeNull();
  });
  it("ne rapproche rien sans durée, sans liste, ou d'un autre jour", () => {
    expect(stravaDe(liste, seance("2026-11-03T07:29:00", null))).toBeNull();
    expect(stravaDe(liste, seance("2026-11-03T07:29:00", 0))).toBeNull();
    expect(stravaDe([], seance("2026-11-03T07:29:00", 3000))).toBeNull();
    expect(stravaDe(liste, seance("2026-11-04T07:29:00", 3000))).toBeNull();
  });
  it("donne aux labels les mots de l'appli", () => {
    expect([libelleLabel("Race"), libelleLabel("Workout"), libelleLabel("LongRun"), libelleLabel("Autre")]).toEqual(["Course", "Entraînement", "Sortie longue", "Autre"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Lap } from "@foulee/core";
import synth from "../../../core/fixtures/synth.json";
import { toSeance } from "../repo/enrich";
import { doubtsOf, firstDoubt, intervalFacts, lastInterval } from "./stats";

type Cas = { name: string; mode: string; seed: number; laps: Lap[] };
const cas = (synth as unknown as Cas[]).find((c) => c.name.startsWith("10×800") && c.mode === "manual" && c.seed === 1) as Cas;

const base = (id: number, day: string) => ({
  id, source: "test", startLocal: `${day} 18:00:00`, type: "running", distance: 11000, duration: 3000, averageSpeed: 3.6, averageHr: 160, maxHr: 175, trainingLoad: null,
  name: "Séance", elevation: null, manualCategory: null, trimp: null, stravaLabels: null,
});

describe("statistiques de séance", () => {
  const s = toSeance(base(1, "2026-11-13"), cas.laps);

  it("allure et FC des seuls efforts d'un fractionné", () => {
    const f = intervalFacts(s);
    expect(f?.efforts).toBe(10);
    // les efforts sont plus rapides que la moyenne de la séance entière (échauffement et récups compris)
    expect(f?.pace).toBeGreaterThan(s.averageSpeed ?? 0);
    expect(f?.hr).not.toBeNull();
  });

  it("pas de faits pour une séance sans tours", () => {
    expect(intervalFacts(toSeance(base(2, "2026-11-12"), []))).toBeNull();
  });

  it("dernier fractionné : le plus récent qui a un titre", () => {
    const easy = toSeance(base(3, "2026-11-14"), []);
    expect(lastInterval([s, easy])?.id).toBe(1);
  });

  it("un doute n'est signalé que dans les 30 derniers jours, jamais sur une séance sans tours", () => {
    expect(doubtsOf(toSeance(base(4, "2026-11-14"), []))).toEqual([]);
    expect(firstDoubt([toSeance(base(5, "2026-01-01"), cas.laps)], "2026-11-14")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { reviewList, type ActivityRow } from "./index";

const run = (id: number, startLocal: string, distance: number, averageSpeed: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id, startLocal, type: "running", distance, duration: distance / averageSpeed, averageSpeed, averageHr: 150, maxHr: 170, trainingLoad: null, name: "Paris Course à pied",
  elevation: null, intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null, ...extra,
});

describe("sorties à classer", () => {
  it("un semi un dimanche matin, FC haute et nom de course : proposé avec ses raisons", () => {
    const semi = run(1, "2026-11-08 09:00:00", 21100, 4.2, { averageHr: 172, name: "Semi de Paris" });
    const [item] = reviewList([semi], 190);
    expect(item?.score).toBe(1 + 1 + 1.5 + 0.5);
    expect(item?.reasons).toEqual(["Distance de course : semi-marathon", "FC moyenne 91 % de ta FC max", "Nom : « Semi de Paris »", "Départ le week-end en matinée"]);
  });
  it("un footing ordinaire ou déjà classé n'est pas proposé", () => {
    expect(reviewList([run(1, "2026-11-10 18:00:00", 8000, 3.3)], 190)).toEqual([]);
    expect(reviewList([run(2, "2026-11-08 09:00:00", 10000, 4.5, { averageHr: 180, manualCategory: "easy", name: "10 km de Lyon" })], 190)).toEqual([]);
  });
  it("le nom par défaut de Garmin ne compte pas, le label Strava « Race » compte fort", () => {
    const a = run(3, "2026-11-10 19:00:00", 7300, 4.0);
    expect(reviewList([a], 190)).toEqual([]);
    const [item] = reviewList([a], 190, () => ({ name: "Corrida du quartier", description: "", labels: ["Race"] }));
    expect(item?.reasons).toEqual(["Label Strava : Course", "Strava : « Corrida du quartier »"]);
  });
  it("plus rapide que 95 % de dix sorties voisines de l'historique", () => {
    const passees = Array.from({ length: 10 }, (_, i) => run(10 + i, `2026-0${1 + (i % 9)}-1${i % 9} 18:00:00`, 10000, 3.4));
    const rapide = run(99, "2026-11-10 19:00:00", 10100, 4.3, { averageHr: 175 });
    const [item] = reviewList([...passees, rapide], 190);
    expect(item?.reasons).toContain("Plus rapide que 100 % de tes sorties de cette distance");
    expect(item?.activity.id).toBe(99);
  });
});

describe("Training Effect", () => {
  it("un Training Effect aérobie très élevé sur une sortie sans fractionné ajoute une raison", () => {
    const a = run(7, "2026-11-10 19:00:00", 15000, 3.7, { averageHr: 183, aerobicTe: 4.5, name: "Semi de test" });
    const [item] = reviewList([a], 190);
    expect(item?.reasons).toContain("Training Effect aérobie 4,5");
    const sans = reviewList([{ ...a, aerobicTe: 4.0 }], 190)[0];
    expect(sans?.reasons.some((r) => r.startsWith("Training Effect"))).toBe(false);
  });
});

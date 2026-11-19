import { describe, expect, it } from "vitest";
import { texteStravaDe, refsNumeriques, type ContexteTexte } from "./texteStrava";
import { REFERENCES_VIDES } from "./references";
import type { Seance } from "../repo";

const base = { id: 1, startLocal: "2026-11-14 08:00:00", type: "running", distance: 10000, duration: 3000, averageSpeed: 3.3, averageHr: 140, maxHr: 160, trainingLoad: null, name: "", elevation: null, intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null, laps: [], overrides: undefined } as unknown as Seance;
const ctx = (extra: Partial<ContexteTexte> = {}): ContexteTexte => ({ charge: 8, refs: REFERENCES_VIDES, remarque: null, specialiteChoisie: null, semaine: null, recuperation: null, ...extra });

describe("texte Strava d'une séance", () => {
  it("convertit les références écrites et ignore les fausses", () => {
    expect(refsNumeriques({ ...REFERENCES_VIDES, vma: "19,2", r5: "16:48", semi: "1:23:48", r10: "abc" })).toEqual({ vma: 19.2, rec5: 1008, rec10: 0, recHalf: 5028 });
  });
  it("un footing donne « Footing » avec la charge, une compétition rien", () => {
    const t = texteStravaDe({ ...base, manualCategory: "easy" }, null, ctx());
    expect(t?.texte.name).toBe("Footing");
    expect(t?.texte.description).toContain("Charge 8/20 (Entraînement léger)");
    expect(texteStravaDe({ ...base, manualCategory: "competition" }, null, ctx())).toBeNull();
  });
  it("le bilan de la semaine et la récupération faible vont avant la signature", () => {
    const t = texteStravaDe({ ...base, manualCategory: "long" }, null, ctx({ semaine: ["Bilan de la semaine : 40 km en 4 séances."], recuperation: "Récupération faible ce matin (forme 48/100)." }));
    const lignes = t!.texte.description.split("\n");
    expect(t?.texte.name).toBe("Sortie longue");
    expect(lignes).toEqual(["Récupération faible ce matin (forme 48/100).", "Charge 8/20 (Entraînement léger)", "", "Bilan de la semaine : 40 km en 4 séances.", "", "🤖 Généré par Foulée"]);
  });
});

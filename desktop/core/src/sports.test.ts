import { describe, expect, it } from "vitest";
import { sportLabel } from "./categories";

describe("noms de sports", () => {
  it("donne le nom français des sports courants de Garmin", () => {
    expect(sportLabel("cycling")).toBe("Vélo");
    expect(sportLabel("lap_swimming")).toBe("Natation");
    expect(sportLabel("hiking")).toBe("Randonnée");
    expect(sportLabel("mountain_biking")).toBe("VTT");
  });
  it("ne devine rien pour un type inconnu, vide ou la course", () => {
    expect(sportLabel("sport_inconnu")).toBeNull();
    expect(sportLabel("")).toBeNull();
    expect(sportLabel("running")).toBeNull();
    expect(sportLabel("constructor")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { lireNombre, lireTemps, manquantes, REFERENCES_VIDES, verifier } from "./references";

describe("références", () => {
  it("lit les temps", () => {
    expect(lireTemps("16:48")).toBe(1008);
    expect(lireTemps("1:23:48")).toBe(5028);
    expect(lireTemps(" 37 : 02 ")).toBe(2222);
    for (const faux of ["", "16", "16:60", "1:75:00", "abc", "0:00", "16:4"]) expect(lireTemps(faux), faux).toBeNull();
  });
  it("lit les nombres avec la virgule", () => {
    expect(lireNombre("19,2", 30)).toBe(19.2);
    expect(lireNombre("0", 30)).toBeNull();
    expect(lireNombre("31", 30)).toBeNull();
    expect(lireNombre("x", 30)).toBeNull();
  });
  it("vide n'est pas une erreur, faux oui", () => {
    expect(verifier(REFERENCES_VIDES)).toEqual({});
    expect(verifier({ ...REFERENCES_VIDES, r5: "16.48", vma: "abc" })).toEqual({ r5: "Comme 16:48", vma: "Un nombre, par exemple 19,2" });
    expect(verifier({ ...REFERENCES_VIDES, fcMax: "180", fcRepos: "190" }).fcRepos).toBeDefined();
  });
  it("dit ce qui manque", () => {
    expect(manquantes(REFERENCES_VIDES)).toEqual(["la VMA", "tes records", "tes fréquences cardiaques"]);
    expect(manquantes({ vma: "19", r5: "16:48", r10: "37:02", semi: "1:23:48", fcMax: "190", fcRepos: "45" })).toEqual([]);
  });
});

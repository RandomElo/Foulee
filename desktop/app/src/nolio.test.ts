import { describe, expect, it } from "vitest";
import { resumeBilan } from "./nolio";

describe("resumeBilan", () => {
  it("dit « à jour » quand rien n'a changé", () => {
    expect(resumeBilan({ fenetres: 17, nouveaux: 0, modifies: 0, erreurs: [] })).toBe("Déjà à jour.");
  });
  it("accorde au singulier et au pluriel", () => {
    expect(resumeBilan({ fenetres: 1, nouveaux: 1, modifies: 1, erreurs: [] })).toBe("1 nouveau, 1 modifié.");
    expect(resumeBilan({ fenetres: 1, nouveaux: 12, modifies: 3, erreurs: [] })).toBe("12 nouveaux, 3 modifiés.");
  });
  it("compte les fiches illisibles et donne la cause de la première", () => {
    expect(resumeBilan({ fenetres: 1, nouveaux: 0, modifies: 0, erreurs: ["tp-1 : HTTP 500"] })).toBe("Déjà à jour. 1 fiche illisible, relis plus tard. Première : tp-1 : HTTP 500");
    expect(resumeBilan({ fenetres: 1, nouveaux: 2, modifies: 0, erreurs: ["a", "b"] })).toBe("2 nouveaux, 0 modifié. 2 fiches illisibles, relis plus tard. Première : a");
  });
});

describe("option d'envoi du RPE", () => {
  it("est éteinte par défaut puis garde le choix", async () => {
    const { optionRpe } = await import("./nolio");
    expect(await optionRpe.lire()).toBe(false);
    await optionRpe.ecrire(true);
    expect(await optionRpe.lire()).toBe(true);
    await optionRpe.ecrire(false);
    expect(await optionRpe.lire()).toBe(false);
  });
});

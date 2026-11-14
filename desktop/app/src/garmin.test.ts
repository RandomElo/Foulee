import { describe, expect, it } from "vitest";
import { resumeBilanGarmin } from "./garmin";

describe("resumeBilanGarmin", () => {
  it("dit que tout est à jour quand rien n'a changé", () => {
    expect(resumeBilanGarmin({ nouvelles: 0, modifiees: 0, tours: 0, jours: 0, ignorees: [] })).toBe("Activités à jour.");
  });
  it("résume activités, tours et santé avec les bons accords", () => {
    expect(resumeBilanGarmin({ nouvelles: 1, modifiees: 1, tours: 1, jours: 1, ignorees: [] })).toBe("1 nouvelle activité, 1 modifiée · 1 séance avec ses tours · santé de 1 jour.");
    expect(resumeBilanGarmin({ nouvelles: 12, modifiees: 3, tours: 30, jours: 7, ignorees: [] })).toBe("12 nouvelles activités, 3 modifiées · 30 séances avec leurs tours · santé de 7 jours.");
  });
  it("signale les éléments illisibles sans les lister", () => {
    expect(resumeBilanGarmin({ nouvelles: 0, modifiees: 0, tours: 0, jours: 2, ignorees: ["a"] })).toBe("Activités à jour · santé de 2 jours. 1 élément illisible ignoré.");
    expect(resumeBilanGarmin({ nouvelles: 0, modifiees: 0, tours: 0, jours: 0, ignorees: ["a", "b"] })).toBe("Activités à jour. 2 éléments illisibles ignorés.");
  });
});

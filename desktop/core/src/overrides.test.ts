import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, describeLaps, type Lap, type LapRole } from "./intervals";

interface Cas { name: string; mode: string; seed: number; laps: Lap[]; kotlin: { roles: string[]; title: string } | null }
const cas = JSON.parse(readFileSync(new URL("../fixtures/synth.json", import.meta.url), "utf8")) as Cas[];
const manuel = cas.find((c) => c.name.startsWith("10×800") && c.mode === "manual" && c.seed === 1) as Cas;

describe("rôles des tours corrigés à la main", () => {
  it("sans correction, le résultat est celui de la détection", () => {
    expect(analyze(manuel.laps)?.title).toBe(manuel.kotlin?.title);
    expect(describeLaps(manuel.laps).source).toBe("deduit");
  });

  it("une liste de choix vide ou tout à null ne change rien", () => {
    expect(analyze(manuel.laps, new Map(), manuel.laps.map(() => null))?.title).toBe(manuel.kotlin?.title);
  });

  it("retirer un effort le passe en « autre » et change le nombre de répétitions", () => {
    const o: (LapRole | null)[] = manuel.laps.map(() => null);
    o[0] = "OTHER";
    const d = describeLaps(manuel.laps, o);
    expect(d.source).toBe("manuel");
    expect(d.roles[0]).toBe("OTHER");
    expect(d.analysis?.title).toContain("9 × 800");
  });

  it("on peut décrire une séance que la détection n'a pas trouvée", () => {
    // Tous les tours à la même allure : aucune détection ; l'utilisateur dit quels tours sont des efforts.
    const plat: Lap[] = Array.from({ length: 8 }, () => ({ distance: 1000, duration: 300, averageSpeed: 3.33, averageHr: 150, maxHr: 160, elevationGain: 0, intensityType: null, stepIndex: null }));
    expect(analyze(plat)).toBeNull();
    const o: (LapRole | null)[] = plat.map((_, i) => (i % 2 === 0 ? "WORK" : "RECOVERY"));
    const a = analyze(plat, new Map(), o);
    expect(a?.groups[0]?.reps.length).toBe(4);
  });

  it("moins de deux efforts : pas de séance", () => {
    const o: (LapRole | null)[] = manuel.laps.map(() => "OTHER");
    o[1] = "WORK";
    expect(analyze(manuel.laps, new Map(), o)).toBeNull();
  });

  it("les tours inutilisables (sans distance ou durée) gardent « autre » et décalent bien les indices", () => {
    const laps: Lap[] = [{ distance: null, duration: 5, averageSpeed: null, averageHr: null, maxHr: null, elevationGain: null, intensityType: null, stepIndex: null }, ...manuel.laps];
    const o: (LapRole | null)[] = laps.map(() => null);
    o[1] = "OTHER";
    const d = describeLaps(laps, o);
    expect(d.roles[0]).toBe("OTHER");
    expect(d.roles[1]).toBe("OTHER");
    expect(d.analysis?.title).toContain("9 × 800");
  });
});

describe("doutes sur les tours déduits", () => {
  it("aucun doute quand la montre a donné les rôles", () => {
    const struct = cas.find((c) => c.mode === "struct") as Cas;
    const d = describeLaps(struct.laps);
    expect(d.source).toBe("garmin");
    expect(d.doubts).toEqual([]);
  });

  it("un doute précis quand l'écart d'allure est faible, et le résultat de la détection ne change pas", () => {
    // Efforts à 3,40 m/s, récups à 3,10 m/s : écart de 1,10 avant seuil… on le fabrique juste au-dessus de 1,12 (détecté) mais sous 1,25 (fragile)
    const laps: Lap[] = Array.from({ length: 11 }, (_, i) => ({ distance: i % 2 === 0 ? 1000 : 300, duration: i % 2 === 0 ? 1000 / 3.6 : 300 / 3.0, averageSpeed: i % 2 === 0 ? 3.6 : 3.0, averageHr: 160, maxHr: 170, elevationGain: 0, intensityType: null, stepIndex: null }));
    const d = describeLaps(laps);
    expect(d.source).toBe("deduit");
    expect(d.doubts).toContain("Écart d'allure faible entre efforts et récups");
    expect(d.analysis?.title).toBe(analyze(laps)?.title);
  });

  it("pas de doute pour une séance franchement marquée", () => {
    const d = describeLaps(manuel.laps);
    expect(d.source).toBe("deduit");
    expect(d.doubts).toEqual([]);
  });

  it("une correction manuelle supprime les doutes", () => {
    const o: (LapRole | null)[] = manuel.laps.map(() => null);
    o[0] = "OTHER";
    expect(describeLaps(manuel.laps, o).doubts).toEqual([]);
  });
});

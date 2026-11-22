import { describe, expect, it } from "vitest";
import { hillsTitle, hillClimbs, type Sample } from "./index";

/** Un parcours plat de `avant` secondes, `n` côtes (montée de `gain` m en `montee` s, descente en `descente` s), puis du plat. Un point toutes les 11 s, comme l'appli. */
function parcours(n: number, gain = 12, montee = 33, descente = 44, avant = 600, apres = 600): Sample[] {
  const out: Sample[] = [];
  const pas = 11;
  // un léger bruit déterministe, comme l'altitude d'une montre (jamais deux points rigoureusement égaux)
  const pt = (t: number, ele: number): Sample => ({ d: t * 3, t, hr: 140, speed: 3, ele: ele + ((t * 37) % 11) * 0.03 });
  let t = 0;
  for (; t < avant; t += pas) out.push(pt(t, 50));
  for (let k = 0; k < n; k++) {
    for (let s = 0; s < montee; s += pas) { out.push(pt(t, 50 + (gain * s) / montee)); t += pas; }
    for (let s = 0; s < descente; s += pas) { out.push(pt(t, 50 + gain - (gain * s) / descente)); t += pas; }
  }
  for (let k = 0; k < apres; k += pas) { out.push(pt(t, 50)); t += pas; }
  return out;
}

describe("côtes lues sur l'altitude", () => {
  it("dix montées régulières donnent « 10 × côte de … »", () => {
    const titre = hillsTitle(parcours(10));
    expect(titre).toMatch(/^10 × côte de 100.m \(\d+.s, \+\d+.m\)$/);
    expect(hillClimbs(parcours(10)).length).toBeGreaterThanOrEqual(10);
  });
  it("les longues montées sont écrites en minutes", () => {
    expect(hillsTitle(parcours(6, 22, 66, 80))).toMatch(/^6 × côte de 200.m \(1.min(.\d\d)?, \+\d+.m\)$/);
  });
  it("sans distances dans la courbe, le titre garde le dénivelé", () => {
    const sansDistance = parcours(10).map((x) => ({ ...x, d: null }));
    expect(hillsTitle(sansDistance)).toMatch(/^10 × côte de \d+.m \(\d+.s\)$/);
  });
  it("quatre montées seulement : pas une séance de côtes", () => {
    expect(hillsTitle(parcours(4))).toBeNull();
  });
  it("un parcours plat, une pente régulière ou du bruit : rien", () => {
    const plat: Sample[] = Array.from({ length: 300 }, (_, i) => ({ d: i * 30, t: i * 11, hr: 140, speed: 3, ele: 50 + ((i * 7) % 3) * 0.2 }));
    expect(hillsTitle(plat)).toBeNull();
    const pente: Sample[] = Array.from({ length: 300 }, (_, i) => ({ d: i * 30, t: i * 11, hr: 140, speed: 3, ele: 50 + i * 0.3 }));
    expect(hillsTitle(pente)).toBeNull();
  });
  it("des montées très inégales ne se ressemblent pas", () => {
    const base = parcours(8);
    // une côte sur deux est trois fois plus haute
    const irregulier = base.map((s) => ({ ...s, ele: s.ele === null ? null : 50 + (s.ele - 50) * (Math.floor((s.t as number) / 77) % 2 === 0 ? 1 : 3) }));
    expect(hillsTitle(irregulier)).toBeNull();
  });
  it("sans altitude ou presque pas de points : rien, sans erreur", () => {
    expect(hillsTitle([])).toBeNull();
    expect(hillsTitle(parcours(10).map((s) => ({ ...s, ele: null })))).toBeNull();
    expect(hillsTitle(parcours(10).slice(0, 20))).toBeNull();
  });
});

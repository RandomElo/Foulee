import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { PALETTES, cssVars, resolveTheme, type Palette } from "./themes";

const all = Object.values(PALETTES);
const AA = 4.5;

describe("contrastes de chaque thème (WCAG AA)", () => {
  for (const p of all) {
    it(`${p.id} : texte sur page, carte et pistes`, () => {
      const lignes: [string, string, string][] = [
        ["texte / page", p.ink, p.page], ["texte / carte", p.ink, p.card], ["texte / piste", p.ink, p.track],
        ["secondaire / page", p.muted, p.page], ["secondaire / carte", p.muted, p.card],
      ];
      for (const [nom, a, b] of lignes) expect(contrast(a, b), `${p.id} ${nom}`).toBeGreaterThanOrEqual(AA);
    });

    it(`${p.id} : couleurs de sens lisibles en texte sur la carte`, () => {
      for (const k of ["accent", "good", "warn", "bad", "violet"] as const) expect(contrast(p[k], p.card), `${p.id} ${k} / carte`).toBeGreaterThanOrEqual(AA);
    });

    it(`${p.id} : texte sombre sur chaque aplat, texte de la barre`, () => {
      for (const k of ["yellow", "pink", "sky", "mint", "orange", "lilac"] as const) expect(contrast(p.fillInk, p[k]), `${p.id} fillInk / ${k}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(p.onBand, p.band), `${p.id} barre`).toBeGreaterThanOrEqual(AA);
    });

    it(`${p.id} : trait visible contre le fond et contre la carte`, () => {
      // Un contour doit se voir : au moins 3:1 (WCAG 1.4.11) en Néo ; le style sobre accepte un trait discret mais perceptible (1,5:1).
      const min = p.family === "neo" ? 3 : 1.5;
      expect(contrast(p.line, p.page), `${p.id} trait / page`).toBeGreaterThanOrEqual(min);
      expect(contrast(p.line, p.card), `${p.id} trait / carte`).toBeGreaterThanOrEqual(min);
    });
  }

  it("le texte sur les cartes de chiffres et sur le bandeau d'attention reste lisible dans chaque thème", () => {
    for (const p of all) {
      const v = cssVars(p);
      for (const bg of ["--stat-blue-bg", "--stat-violet-bg", "--stat-green-bg", "--stat-yellow-bg"]) {
        expect(contrast(v["--stat-ink"] as string, v[bg] as string)).toBeGreaterThanOrEqual(AA);
        expect(contrast(v["--stat-muted"] as string, v[bg] as string), `${p.id} ${bg} secondaire`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

describe("choix du thème", () => {
  it("auto suit le système, clair et sombre l'ignorent", () => {
    expect(resolveTheme("foulee", "auto", true)).toBe("foulee-dark");
    expect(resolveTheme("foulee", "auto", false)).toBe("foulee-light");
    expect(resolveTheme("foulee", "dark", false)).toBe("foulee-dark");
    expect(resolveTheme("foulee", "light", true)).toBe("foulee-light");
  });

  it("Néo reste clair quel que soit le mode ou le système", () => {
    for (const mode of ["auto", "light", "dark"] as const) for (const sys of [true, false]) expect(resolveTheme("neo", mode, sys)).toBe("neo-light");
    expect(Object.keys(PALETTES).sort()).toEqual(["foulee-dark", "foulee-light", "neo-light"]);
  });

  it("chaque thème fournit toutes les variables, sans valeur vide", () => {
    const cles = Object.keys(cssVars(PALETTES["neo-light"])).sort();
    for (const p of all) {
      const v = cssVars(p);
      expect(Object.keys(v).sort()).toEqual(cles);
      for (const [k, val] of Object.entries(v)) expect(val, `${p.id} ${k}`).not.toBe("");
    }
  });

  it("une palette ne contient que des couleurs #rrggbb", () => {
    for (const p of all as Palette[]) for (const [k, v] of Object.entries(p)) if (typeof v === "string" && !["id", "family"].includes(k)) expect(v, `${p.id} ${k}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

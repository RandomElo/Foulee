// Les thèmes de Foulée PC, comme sur le mobile : Foulée (sobre, clair et sombre) et Néo (toujours clair : un Néo sombre a été essayé, il était laid).
// Source de vérité des couleurs : les CSS variables sont générées d'ici, et themes.test.ts vérifie les contrastes de chaque thème.

export type Family = "foulee" | "neo";
export type Mode = "auto" | "light" | "dark";
export type ThemeId = "foulee-light" | "foulee-dark" | "neo-light";

export interface Palette {
  id: ThemeId;
  family: Family;
  dark: boolean;
  /** Fond de page, cartes, traits, texte, texte secondaire. */
  page: string; card: string; line: string; ink: string; muted: string;
  /** Couleurs de sens, toutes lisibles en texte sur la carte (≥ 4,5:1). */
  accent: string; good: string; warn: string; bad: string; violet: string;
  /** Fond des zones neutres (pistes de jauge, cases vides). */
  track: string;
  /** Aplats colorés du style Néo ; le texte posé dessus est toujours `fillInk`. */
  yellow: string; pink: string; sky: string; mint: string; orange: string; lilac: string; fillInk: string;
  /** Barre du haut. */
  band: string; onBand: string;
  /** Ombre pleine décalée (Néo) et épaisseur des traits, en px. */
  shadow: string; outline: number; offset: number; radius: number;
}

const flat = { yellow: "#F7D774", pink: "#F5A9C0", sky: "#9ADAF2", mint: "#ABE5AB", orange: "#F3B672", lilac: "#C9B9F2", fillInk: "#222222" };

export const PALETTES: Record<ThemeId, Palette> = {
  "foulee-light": {
    id: "foulee-light", family: "foulee", dark: false,
    page: "#F8FAFC", card: "#FFFFFF", line: "#B6C2D2", ink: "#0F172A", muted: "#556275",
    accent: "#1F66BF", good: "#047857", warn: "#B45309", bad: "#C62828", violet: "#5B48C9", track: "#E2E8F0",
    ...flat, band: "#FFFFFF", onBand: "#0F172A", shadow: "#0F172A", outline: 1, offset: 0, radius: 16,
  },
  "foulee-dark": {
    id: "foulee-dark", family: "foulee", dark: true,
    page: "#020617", card: "#0F172A", line: "#334155", ink: "#F1F5F9", muted: "#A3B1C6",
    accent: "#6FA8F0", good: "#34D399", warn: "#FBBF24", bad: "#F87171", violet: "#A79DF2", track: "#1E293B",
    ...flat, band: "#0F172A", onBand: "#F1F5F9", shadow: "#000000", outline: 1, offset: 0, radius: 16,
  },
  "neo-light": {
    id: "neo-light", family: "neo", dark: false,
    page: "#FBF6E9", card: "#FFFFFF", line: "#2A2A2A", ink: "#222222", muted: "#5A5A5A",
    accent: "#2F5BD1", good: "#1F7A3E", warn: "#A35A10", bad: "#B02A44", violet: "#5B46C8", track: "#F1E8CC",
    ...flat, band: "#F7D774", onBand: "#222222", shadow: "#2A2A2A", outline: 2.5, offset: 3.5, radius: 14,
  },
};

/** Le thème effectif selon la famille, le mode choisi et le réglage du système. Néo n'a pas de version sombre : le mode ne s'applique qu'à Foulée. */
export function resolveTheme(family: Family, mode: Mode, systemDark: boolean): ThemeId {
  if (family === "neo") return "neo-light";
  const dark = mode === "dark" || (mode === "auto" && systemDark);
  return dark ? "foulee-dark" : "foulee-light";
}

/** Les variables CSS d'un thème (le CSS les lit, aucun composant ne code de couleur en dur). */
export function cssVars(p: Palette): Record<string, string> {
  const neo = p.family === "neo";
  return {
    "--c-page": p.page, "--c-card": p.card, "--c-line": p.line, "--c-ink": p.ink, "--c-muted": p.muted,
    "--c-accent": p.accent, "--c-good": p.good, "--c-warn": p.warn, "--c-bad": p.bad, "--c-violet": p.violet, "--c-track": p.track,
    "--c-yellow": p.yellow, "--c-pink": p.pink, "--c-sky": p.sky, "--c-mint": p.mint, "--c-orange": p.orange, "--c-lilac": p.lilac, "--c-fill-ink": p.fillInk,
    "--c-band": p.band, "--c-on-band": p.onBand, "--c-shadow": p.shadow,
    "--outline": `${p.outline}px`, "--offset": `${p.offset}px`, "--radius": `${p.radius}px`,
    // Cartes de chiffres : aplat coloré en Néo, carte neutre avec chiffre coloré en Foulée.
    "--stat-blue-bg": neo ? p.sky : p.card, "--stat-violet-bg": neo ? p.lilac : p.card, "--stat-green-bg": neo ? p.mint : p.card, "--stat-yellow-bg": neo ? p.yellow : p.dark ? "#3B2F0F" : "#FEF3C7",
    "--stat-ink": neo ? p.fillInk : p.ink, "--stat-muted": neo ? "#3C3C3C" : p.muted,
    "--stat-blue-num": neo ? p.fillInk : p.accent, "--stat-violet-num": neo ? p.fillInk : p.violet, "--stat-green-num": neo ? p.fillInk : p.good,
    // Une couleur par type de séance, reprise partout.
    "--cat-interval": neo ? p.pink : p.violet, "--cat-long": neo ? p.sky : p.accent, "--cat-easy": neo ? p.mint : p.good,
    "--cat-competition": neo ? p.yellow : p.warn, "--cat-threshold": neo ? p.orange : p.warn, "--cat-other": neo ? p.lilac : p.muted,
    // Barres de graphique : pastel en Néo, couleur d'accent en Foulée ; la barre en cours est d'une autre teinte.
    "--bar": neo ? p.sky : p.accent, "--bar-cur": neo ? p.yellow : p.violet,
    "color-scheme": p.dark ? "dark" : "light",
  };
}

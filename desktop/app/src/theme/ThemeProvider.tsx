import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { repo } from "../repo";
import { PALETTES, cssVars, resolveTheme, type Family, type Mode, type ThemeId } from "./themes";

interface Choice { family: Family; mode: Mode }
interface Ctx extends Choice { theme: ThemeId; set: (c: Partial<Choice>) => void }

const KEY = "foulee-theme";
/** Par défaut : le style Néo, et le mode automatique (suit le système). */
const DEFAULT: Choice = { family: "neo", mode: "auto" };
const Theme = createContext<Ctx | null>(null);

function parse(raw: string | null): Choice | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Choice> | null;
    if (v && (v.family === "foulee" || v.family === "neo") && (v.mode === "auto" || v.mode === "light" || v.mode === "dark")) return { family: v.family, mode: v.mode };
  } catch { /* valeur illisible : on garde le défaut */ }
  return null;
}
function cached(): Choice | null {
  try { return parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>(() => cached() ?? DEFAULT);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Le réglage enregistré dans la base fait foi ; le cache du navigateur n'évite que le flash au démarrage.
  useEffect(() => { repo.getSetting("theme").then((raw) => { const c = parse(raw); if (c) setChoice(c); }).catch(() => undefined); }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const theme = resolveTheme(choice.family, choice.mode, systemDark);
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cssVars(PALETTES[theme]))) root.style.setProperty(k, v);
    root.dataset.theme = theme;
  }, [theme]);

  const set = useCallback((c: Partial<Choice>) => {
    setChoice((prev) => {
      const next = { ...prev, ...c };
      const raw = JSON.stringify(next);
      try { localStorage.setItem(KEY, raw); } catch { /* stockage indisponible : le réglage reste dans la base */ }
      repo.setSetting("theme", raw).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...choice, theme, set }), [choice, theme, set]);
  return <Theme.Provider value={value}>{children}</Theme.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(Theme);
  if (!c) throw new Error("useTheme hors du ThemeProvider");
  return c;
}

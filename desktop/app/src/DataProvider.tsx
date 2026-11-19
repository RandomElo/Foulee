import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { analyzeLoad, SessionHistory, type Analysis } from "@foulee/core";
import { repo, type Donnees } from "./repo";
import { garmin } from "./garmin";
import { localToday } from "./lib/format";
import { lireNombre, REFERENCES_VIDES, type References } from "./lib/references";
import { lireReferences } from "./lib/referencesStockage";
import { refsNumeriques } from "./lib/texteStrava";

interface Ctx {
  data: Donnees;
  analysis: Analysis;
  /** Les références du coureur (VMA, records, FC) : elles règlent la charge, les zones et les allures de course. */
  refs: References;
  /** Chaque fractionné comparé à ses séances passées (remarque, note, bilan de la semaine). */
  historique: SessionHistory;
  today: string;
  prenom: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setPrenom: (p: string) => void;
  /** null tant qu'on ne sait pas ; faux : premier lancement, l'accueil de départ s'affiche. */
  onboarde: boolean | null;
  terminerOnboarding: () => Promise<void>;
  /** Efface toutes les données locales et revient au premier lancement. */
  recommencer: () => Promise<void>;
}

const VIDE: Donnees = { seances: [], daily: [], feelings: [], nolio: [], strava: [] };
const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Donnees>(VIDE);
  const [prenom, setPrenomState] = useState("");
  const [refs, setRefs] = useState<References>(REFERENCES_VIDES);
  const [onboarde, setOnboarde] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  const reload = useCallback(async () => {
    try {
      const d = await repo.load();
      setData(d);
      setRefs(await lireReferences().catch(() => REFERENCES_VIDES));
      // Déjà passé par l'accueil de départ, ou des données réelles sont déjà là (installation antérieure) : pas de nouvel accueil.
      const fait = (await repo.getSetting("onboarding")) === "fait" || d.seances.some((x) => x.source !== "demo");
      // Pendant l'accueil de départ, une lecture qui apporte des données ne le ferme pas : c'est le bouton « Terminer » qui le fait.
      setOnboarde((avant) => (avant === false ? false : fait));
      // Le prénom peut venir d'une lecture de Garmin : relu avec les données.
      repo.getSetting("prenom").then((p) => setPrenomState(p ?? "")).catch(() => undefined);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); repo.getSetting("prenom").then((p) => setPrenomState(p ?? "")).catch(() => undefined); }, [reload]);

  // Le calcul de charge relit tout l'historique : refait seulement quand les données changent.
  const analysis = useMemo(
    () => analyzeLoad(data.seances, data.daily, today, { hrMax: lireNombre(refs.fcMax, 250) ?? 0, hrRest: lireNombre(refs.fcRepos, 150) ?? 0 }),
    [data, today, refs.fcMax, refs.fcRepos],
  );
  const historique = useMemo(
    () => new SessionHistory(data.seances, new Map(data.seances.filter((x) => x.intervalTitle !== null).map((x) => [x.id, x.laps])), analysis, refsNumeriques(refs)),
    [data.seances, analysis, refs],
  );

  const setPrenom = useCallback((p: string) => { setPrenomState(p); repo.setSetting("prenom", p).catch(() => undefined); }, []);
  const terminerOnboarding = useCallback(async () => { await repo.setSetting("onboarding", "fait"); setOnboarde(true); }, []);
  const recommencer = useCallback(async () => {
    await garmin.deconnecter().catch(() => undefined);
    await repo.resetAll();
    setPrenomState("");
    await reload();
    setOnboarde(false);
  }, [reload]);
  const value = useMemo(() => ({ data, analysis, refs, historique, today, prenom, loading, error, reload, setPrenom, onboarde, terminerOnboarding, recommencer }), [data, analysis, refs, historique, today, prenom, loading, error, reload, setPrenom, onboarde, terminerOnboarding, recommencer]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData hors du DataProvider");
  return c;
}

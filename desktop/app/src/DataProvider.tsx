import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { analyzeLoad, type Analysis } from "@foulee/core";
import { repo, type Donnees } from "./repo";
import { localToday } from "./lib/format";

interface Ctx {
  data: Donnees;
  analysis: Analysis;
  today: string;
  prenom: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setPrenom: (p: string) => void;
}

const VIDE: Donnees = { seances: [], daily: [], feelings: [], nolio: [], strava: [] };
const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Donnees>(VIDE);
  const [prenom, setPrenomState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  const reload = useCallback(async () => {
    try {
      setData(await repo.load());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); repo.getSetting("prenom").then((p) => setPrenomState(p ?? "")).catch(() => undefined); }, [reload]);

  // Le calcul de charge relit tout l'historique : refait seulement quand les données changent.
  const analysis = useMemo(() => analyzeLoad(data.seances, data.daily, today), [data, today]);

  const setPrenom = useCallback((p: string) => { setPrenomState(p); repo.setSetting("prenom", p).catch(() => undefined); }, []);
  const value = useMemo(() => ({ data, analysis, today, prenom, loading, error, reload, setPrenom }), [data, analysis, today, prenom, loading, error, reload, setPrenom]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData hors du DataProvider");
  return c;
}

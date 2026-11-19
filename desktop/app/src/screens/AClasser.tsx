import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { categoryLabel, type ReviewItem } from "@foulee/core";
import { Check, Trophy } from "lucide-react";
import { useData } from "../DataProvider";
import { Empty } from "../components/ui";
import { repo } from "../repo";
import { fmtDayLong, fmtKm, fmtPace, fmtTime, cap, texteErreur } from "../lib/format";
import { sortiesAClasser } from "../lib/aClasser";

const TYPES = ["competition", "interval", "long", "easy"] as const;

/** Les sorties qui ressemblent à une compétition d'après des règles simples. Classer une sortie la fait sortir de la liste pour de bon. */
export function AClasser() {
  const { data, analysis, reload, loading } = useData();
  const [fait, setFait] = useState<Set<number>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const items = useMemo(() => sortiesAClasser(data, analysis.refs.max), [data, analysis.refs.max]);
  if (loading) return <p className="sub" role="status">Chargement…</p>;
  const restant = items.filter((i) => !fait.has(i.activity.id));
  const classer = async (item: ReviewItem, type: string) => {
    setErreur(null);
    try { await repo.setCategory(item.activity.id, type); setFait((f) => new Set(f).add(item.activity.id)); await reload(); }
    catch (e) { setErreur(texteErreur(e)); }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link className="btn btn-main" to="/activites">← Activités</Link>
        <h1 className="title text-2xl">À classer</h1>
        <span className="sub">{restant.length} sortie{restant.length > 1 ? "s" : ""} à vérifier</span>
      </div>
      {erreur ? <p role="alert" className="mt-3 font-bold text-bad">{erreur}</p> : null}
      {restant.length === 0 ? <div className="mt-4"><Empty>Tout est classé.</Empty></div> : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-stretch gap-[18px]">
          {restant.map((item) => {
            const a = item.activity;
            return (
              <section key={a.id} className="card flex flex-col gap-3" aria-label={a.name}>
                <div>
                  <Link to={`/activites/${a.id}`} className="font-black underline">{a.name || "Sortie"}</Link>
                  <div className="sub">{cap(fmtDayLong(a.startLocal))}, {fmtTime(a.startLocal)}</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3"><b className="text-2xl font-black">{fmtKm(a.distance)}</b><span className="sub">{fmtPace(a.averageSpeed)}</span></div>
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {item.reasons.map((r) => <li key={r} className="pill inline-flex items-center gap-1" style={{ background: "var(--c-track)", color: "var(--c-ink)" }}><Check size={12} aria-hidden />{r}</li>)}
                </ul>
                <div>
                  <b className="mb-1.5 block text-[13px] font-black uppercase">Classer comme</b>
                  <div className="flex flex-wrap gap-2">
                    {TYPES.map((t) => (
                      <button key={t} className={`btn ${t === "competition" ? "btn-main" : ""}`} onClick={() => void classer(item, t)}>
                        {t === "competition" ? <Trophy size={16} aria-hidden /> : null}{categoryLabel(t)}{t === item.detected ? " (détecté)" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

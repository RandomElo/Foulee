import { useMemo } from "react";
import { Link } from "react-router-dom";
import { groupWeeks } from "@foulee/core";
import { useData } from "../DataProvider";
import { Dot, Empty } from "../components/ui";
import { fmtDayMonth, fmtDayShort, fmtKm, fmtKmValue } from "../lib/format";
import { doubtsOf } from "../lib/stats";
import type { Seance } from "../repo";

export const titleOf = (s: Seance): string => s.intervalTitle ?? (s.name || "Séance");

export function SeanceRow({ s, current = false }: { s: Seance; current?: boolean }) {
  const doubt = doubtsOf(s).length > 0;
  return (
    <Link to={`/activites/${s.id}`} aria-current={current ? "true" : undefined}
      className={`grid grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 rounded-lg border-b-2 border-track px-1.5 py-2.5 text-ink no-underline last:border-b-0 hover:bg-track ${current ? "!bg-sky !text-fill-ink" : ""}`}>
      <Dot a={s} />
      <span className="break-words font-bold">{titleOf(s)}</span>
      <span className="col-start-2 flex flex-wrap items-center gap-3">
        <span className={`text-sm ${current ? "text-fill-ink" : "text-muted"}`}>{fmtDayShort(s.startLocal)}</span>
        <b>{fmtKm(s.distance)}</b>
        {doubt ? <span className="pill">À vérifier</span> : null}
      </span>
    </Link>
  );
}

export function Activites() {
  const { data, loading } = useData();
  const weeks = useMemo(() => groupWeeks(data.seances), [data.seances]);
  if (loading) return <p className="sub" role="status">Chargement…</p>;
  if (weeks.length === 0) return <Empty>Aucune séance pour l'instant.</Empty>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-stretch gap-[18px]">
      {weeks.map((w) => (
        <section key={w.start} className="card" aria-label={`Semaine du ${fmtDayMonth(w.start)}`}>
          <div className="mb-1.5 flex items-baseline justify-between"><h2 className="title">Semaine du {fmtDayMonth(w.start)}</h2><b>{fmtKmValue(w.km)} km</b></div>
          {w.sessions.map((s) => <SeanceRow key={s.id} s={s} />)}
        </section>
      ))}
    </div>
  );
}

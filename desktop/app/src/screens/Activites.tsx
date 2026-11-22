import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Squelette } from "../components/Squelette";
import { categoryOf, groupWeeks, sportLabel } from "@foulee/core";
import { sortiesAClasser } from "../lib/aClasser";
import { useData } from "../DataProvider";
import { Dot, Empty } from "../components/ui";
import { fmtDayMonth, fmtDayShort, fmtKmOuHeure, fmtKmValue } from "../lib/format";
import { doubtsOf } from "../lib/stats";
import type { Seance } from "../repo";

/** Le titre d'une séance : le fractionné détecté, sinon pour un autre sport le vrai sport (Vélo, Natation…), sinon le nom donné par la montre. */
export const titleOf = (s: Seance): string => s.intervalTitle ?? ((categoryOf(s) === "other" ? sportLabel(s.type) : null) ?? (s.name || "Séance"));

export function SeanceRow({ s, current = false }: { s: Seance; current?: boolean }) {
  const doubt = doubtsOf(s).length > 0;
  return (
    <Link to={`/activites/${s.id}`} aria-current={current ? "true" : undefined}
      className={`grid grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 rounded-lg border-b-2 border-track px-1.5 py-2.5 text-ink no-underline last:border-b-0 hover:bg-track ${current ? "!bg-sky !text-fill-ink" : ""}`}>
      <Dot a={s} />
      <span className="break-words font-bold">{titleOf(s)}</span>
      <span className="col-start-2 flex flex-wrap items-center gap-3">
        <span className={`text-sm ${current ? "text-fill-ink" : "text-muted"}`}>{fmtDayShort(s.startLocal)}</span>
        <b>{fmtKmOuHeure(s.distance, s.startLocal)}</b>
        {doubt ? <span className="pill">À vérifier</span> : null}
      </span>
    </Link>
  );
}

export function Activites() {
  const { data, analysis, loading } = useData();
  const [params] = useSearchParams();
  const semaine = /^\d{4}-\d{2}-\d{2}$/.test(params.get("semaine") ?? "") ? params.get("semaine") : null;
  const toutes = useMemo(() => groupWeeks(data.seances), [data.seances]);
  const aClasser = useMemo(() => sortiesAClasser(data, analysis.refs.max).length, [data, analysis.refs.max]);
  const weeks = semaine ? toutes.filter((w) => w.start === semaine) : toutes;
  if (loading) return <Squelette />;
  if (toutes.length === 0) return <Empty>Aucune séance pour l'instant.</Empty>;
  return (
    <>
      {aClasser > 0 && !semaine ? (
        <div className="card card-yellow mb-[18px] flex flex-wrap items-center justify-between gap-3">
          <b>{aClasser} sortie{aClasser > 1 ? "s" : ""} ressemble{aClasser > 1 ? "nt" : ""} à une course</b>
          <Link className="btn" to="/a-classer">Classer</Link>
        </div>
      ) : null}
      {semaine ? (
        <div className="mb-[18px] flex flex-wrap items-center gap-3">
          <Link className="btn btn-main" to="/activites">← Toutes les semaines</Link>
          <b>Semaine du {fmtDayMonth(semaine)}</b>
        </div>
      ) : null}
      {weeks.length === 0 ? <Empty>Aucune séance cette semaine-là.</Empty> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-stretch gap-[18px]">
          {weeks.map((w) => (
            <section key={w.start} className="card" aria-label={`Semaine du ${fmtDayMonth(w.start)}`}>
              <div className="mb-1.5 flex items-baseline justify-between"><h2 className="title">Semaine du {fmtDayMonth(w.start)}</h2><b>{fmtKmValue(w.km)} km</b></div>
              {w.sessions.map((s) => <SeanceRow key={s.id} s={s} />)}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

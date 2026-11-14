import { useState } from "react";
import { Link } from "react-router-dom";
import { dayOf, isRun, kmPerWeek, loadZoneOf, LOAD_ZONES, addDays, weekStart } from "@foulee/core";
import { useData } from "../DataProvider";
import { KmChart } from "../components/KmChart";
import { RessentiModal } from "../components/RessentiModal";
import { Empty } from "../components/ui";
import { cap, fmtDayLong, fmtKmValue, fmtNum, fmtPace, fmtTime, fmtWeekday1 } from "../lib/format";
import { firstDoubt, intervalFacts, lastInterval } from "../lib/stats";
import { repo } from "../repo";

const rpeClass = (n: number) => (n <= 3 ? "bg-mint" : n <= 5 ? "bg-yellow" : n <= 7 ? "bg-orange" : "bg-pink");

export function Accueil() {
  const { data, analysis, today, prenom, loading, error, reload } = useData();
  const [ressenti, setRessenti] = useState(false);

  if (loading) return <p className="sub" role="status">Chargement…</p>;
  if (error) return <div className="card text-bad" role="alert">Lecture impossible : {error}</div>;

  const hello = (
    <div className="mb-[18px] flex items-center gap-3.5">
      <div aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full border-[length:var(--outline)] border-line bg-sky text-[22px] font-black text-fill-ink">{(prenom || "F").charAt(0).toUpperCase()}</div>
      <div><span className="sub text-[15px]">{cap(fmtDayLong(today))}</span><b className="block text-[26px] font-black">{prenom ? `Bonjour ${prenom}` : "Bonjour"}</b></div>
    </div>
  );

  if (data.seances.length === 0) {
    return (
      <>{hello}
        <Empty>
          <p className="m-0 font-bold">Aucune séance pour l'instant.</p>
          <p className="sub mb-3 mt-1">Connecte une source (Garmin, Nolio) pour voir ton tableau de bord.</p>
          {import.meta.env.DEV ? <button className="btn btn-main" onClick={async () => { await repo.loadDemo(); await reload(); }}>Charger des données de démo</button> : null}
        </Empty>
      </>
    );
  }

  const weeks = kmPerWeek(data.seances, today, 8);
  const cur = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const sorties = data.seances.filter((a) => isRun(a) && weekStart(dayOf(a)) === cur?.start).length;

  const total = analysis.globalPartsOn(today)?.total ?? null;
  const zone = total !== null ? loadZoneOf(total) : null;
  const pts = analysis.load;
  const weekNow = pts[pts.length - 1]?.week ?? null;
  const delta = weekNow !== null && analysis.previousWeek !== null ? Math.round((weekNow - analysis.previousWeek) * 10) / 10 : null;

  const readiness = analysis.readiness?.date === today ? analysis.readiness : null;
  const sleep = readiness?.factors.find((f) => f.key === "sleep");

  const monday = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const rpeOf = (d: string): number | null => {
    const ids = new Set(data.seances.filter((s) => dayOf(s) === d).map((s) => s.id));
    const f = data.feelings.filter((x) => ids.has(x.activityId) && x.rpe !== null).pop();
    return f?.rpe ?? null;
  };

  const last = lastInterval(data.seances);
  const facts = last ? intervalFacts(last) : null;
  const doubt = firstDoubt(data.seances, today);
  const lastFeeling = last ? data.feelings.find((f) => f.activityId === last.id) : undefined;

  return (
    <>
      {hello}
      {doubt ? (
        <div className="card card-yellow mb-[18px] flex flex-wrap items-center justify-between gap-3.5 font-bold">
          <div><h2 className="title">Tours à vérifier</h2><div>{doubt.seance.intervalTitle} : {doubt.doubt.charAt(0).toLowerCase() + doubt.doubt.slice(1)}.</div></div>
          <Link className="btn" to={`/activites/${doubt.seance.id}`}>Corriger</Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-stretch gap-[18px] min-[700px]:grid-cols-2 min-[1300px]:grid-cols-4">
        <section className="card card-blue" aria-labelledby="h-sem">
          <h2 className="title" id="h-sem">Cette semaine</h2>
          <div className="my-2 text-[40px] font-black leading-tight" style={{ color: "var(--stat-blue-num)" }}>{fmtKmValue(cur?.km ?? 0)} <small className="text-base font-semibold">km</small></div>
          <div className="sub">{sorties} sortie{sorties > 1 ? "s" : ""} depuis lundi · semaine dernière : {fmtKmValue(prev?.km ?? 0)} km</div>
        </section>

        <section className="card card-violet" aria-labelledby="h-charge">
          <h2 className="title" id="h-charge">Charge globale</h2>
          <div className="my-2 text-[40px] font-black leading-tight" style={{ color: "var(--stat-violet-num)" }}>{total !== null ? fmtNum(total) : "–"} <small className="text-base font-semibold">/ 20</small></div>
          <div className="zones mb-1.5" role="img" aria-label={zone ? `Zone : ${zone.label}` : "Zone inconnue"}>
            {LOAD_ZONES.map((z) => <i key={z.index} className={zone ? (z.index < zone.index ? "on" : z.index === zone.index ? "cur" : "") : ""} />)}
          </div>
          <div className="sub">{zone ? zone.label : "Pas assez d'historique"}{delta !== null && analysis.previousWeek !== null ? ` · ${delta >= 0 ? "↗ +" : "↘ −"}${fmtNum(Math.abs(delta))} vs ${fmtNum(analysis.previousWeek)} les 3 semaines d'avant` : ""}</div>
        </section>

        <section className="card card-green" aria-labelledby="h-forme">
          <h2 className="title" id="h-forme">Forme du jour</h2>
          <div className="my-2 text-[40px] font-black leading-tight" style={{ color: "var(--stat-green-num)" }}>{readiness ? readiness.score : "–"} <small className="text-base font-semibold">/ 100</small></div>
          <div className="sub">{readiness ? `${readiness.label}${sleep ? ` · sommeil ${sleep.display}, ${sleep.note}` : ""}` : "Pas de nuit synchronisée ce matin"}</div>
        </section>

        <section className="card" aria-labelledby="h-sens">
          <h2 className="title" id="h-sens">Tes sensations</h2>
          <div className="sub">Effort perçu (RPE) cette semaine</div>
          <div className="mt-2.5 grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const n = rpeOf(d);
              return (
                <div key={d} className="text-center text-xs font-extrabold uppercase">
                  {fmtWeekday1(d)}
                  <b className={`mt-1 grid h-9 place-items-center rounded-[10px] border-[length:var(--outline)] border-line text-base ${n !== null ? `${rpeClass(n)} text-fill-ink` : "bg-track text-muted"}`} aria-label={n !== null ? `RPE ${n}` : "Pas de ressenti"}>{n ?? "–"}</b>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card min-[700px]:col-span-2" aria-labelledby="h-last">
          <h2 className="title" id="h-last">Dernier fractionné</h2>
          {last ? (
            <>
              <h3 className="mb-0.5 mt-2 text-xl font-black">{last.intervalTitle}</h3>
              <div className="sub">{fmtDayLong(last.startLocal)}, {fmtTime(last.startLocal)}</div>
              <div className="my-3 flex flex-wrap gap-6">
                <div><b className="block whitespace-nowrap text-xl font-black">{fmtPace(facts?.pace ?? null)}</b><span className="sub">allure des efforts</span></div>
                <div><b className="block text-xl font-black">{facts?.hr ?? "–"}</b><span className="sub">FC des efforts</span></div>
                <div><b className="block whitespace-nowrap text-xl font-black">{analysis.globalAfter(last) ? `${fmtNum(analysis.globalAfter(last)?.total ?? 0)} / 20` : "–"}</b><span className="sub">charge globale</span></div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link className="btn" to={`/activites/${last.id}`}>Voir la séance</Link>
                <button className="btn btn-main" onClick={() => setRessenti(true)}>{lastFeeling?.rpe ? `RPE ${lastFeeling.rpe} · modifier` : "Ressenti"}</button>
              </div>
            </>
          ) : <p className="sub mt-2">Pas encore de fractionné détecté.</p>}
        </section>

        <section className="card min-[700px]:col-span-2" aria-labelledby="h-km">
          <h2 className="title" id="h-km">Km par semaine</h2>
          <div className="mt-2"><KmChart weeks={weeks} /></div>
          <div className="sub mt-2">Pointillés : moyenne des 4 semaines d'avant. Semaine en cours non terminée.</div>
        </section>
      </div>

      {ressenti && last ? <RessentiModal seance={last} existing={lastFeeling} onClose={() => setRessenti(false)} /> : null}
    </>
  );
}

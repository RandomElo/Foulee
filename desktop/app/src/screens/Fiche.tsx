import { Chevron } from "../components/Chevron";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDays, categoryLabel, categoryOf, describeLaps, groupWeeks, isReviewDay, recoveryLine, sessionRemark, sportLabel, weekReviewOf, weekLines, weekStart, dayOf } from "@foulee/core";
import { useData } from "../DataProvider";
import { PrevuModal } from "../components/PrevuModal";
import { RessentiModal } from "../components/RessentiModal";
import { ROLE_LABEL, ToursModal } from "../components/ToursModal";
import { Empty, catVar } from "../components/ui";
import { cap, fmtClock, fmtDayLong, fmtDayMonth, fmtKm, fmtKmValue, fmtLong, fmtMeters, fmtNum, fmtPace, fmtTime } from "../lib/format";
import { fmtAllure, positionSousLimite, prevuDe } from "../lib/nolio";
import { libelleLabel, stravaDe } from "../lib/strava";
import { doubtsOf, intervalFacts } from "../lib/stats";
import { SeanceRow, titleOf } from "./Activites";
import type { References } from "../lib/references";
import { refsNumeriques, texteStravaDe } from "../lib/texteStrava";
import { proposedSpeciality, type IntervalAnalysis } from "@foulee/core";

/** La spécialité que les allures suggèrent pour ce fractionné, ou null. */
function stravaPropose(s: { intervalTitle: string | null }, analyse: IntervalAnalysis | null, refs: References): string | null {
  return s.intervalTitle !== null && analyse ? proposedSpeciality(analyse, refsNumeriques(refs)) : null;
}

export function Fiche() {
  const { id } = useParams();
  const { data, analysis, loading, refs, historique: histo } = useData();
  const [ressenti, setRessenti] = useState(false);
  const [tours, setTours] = useState(false);
  const [prevuOuvert, setPrevuOuvert] = useState(false);
  const [copie, setCopie] = useState<string | null>(null);
  const [avecSpe, setAvecSpe] = useState(false);
  const s = data.seances.find((x) => String(x.id) === id);
  if (loading) return <p className="sub" role="status">Chargement…</p>;
  if (!s) return <><Link className="btn btn-main" to="/activites">← Activités</Link><div className="mt-4"><Empty>Cette séance n'existe pas (ou plus).</Empty></div></>;

  const feeling = data.feelings.find((f) => f.activityId === s.id);
  const facts = s.intervalTitle ? intervalFacts(s) : null;
  const doubts = doubtsOf(s);
  const detail = s.laps.length > 0 ? describeLaps(s.laps, s.overrides) : null;
  const week = groupWeeks(data.seances).find((w) => w.start === weekStart(dayOf(s)));
  const load = analysis.globalAfter(s)?.total ?? null;
  const cat = categoryOf(s);
  const prevu = prevuDe(data.nolio, s);
  const sur = stravaDe(data.strava, s);
  const limite = prevu ? positionSousLimite(prevu, facts?.pace ?? s.averageSpeed) : null;

  const numbers = (
    <div className="card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
      <div><b className="block whitespace-nowrap text-2xl font-black">{fmtKm(s.distance)}</b><span className="sub">distance</span></div>
      <div><b className="block text-2xl font-black">{fmtClock(s.duration)}</b><span className="sub">durée</span></div>
      <div><b className="block whitespace-nowrap text-2xl font-black">{fmtPace(facts?.pace ?? s.averageSpeed)}</b><span className="sub">{facts ? "allure des efforts" : "allure"}</span></div>
      <div><b className="block whitespace-nowrap text-2xl font-black">{facts?.hr ?? (s.averageHr !== null ? Math.round(s.averageHr) : "–")} bpm</b><span className="sub">{facts ? "FC des efforts" : "FC moyenne"}</span></div>
      <div><b className="block whitespace-nowrap text-2xl font-black">{load !== null ? `${fmtNum(load)} / 20` : "–"}</b><span className="sub">charge globale</span></div>
    </div>
  );

  const prevuCard = prevu ? (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="title">Prévu par ton coach</h2>
        <div className="sub mt-1">{[prevu.titre, prevu.dureeS !== null ? fmtClock(prevu.dureeS) : null, prevu.distanceM !== null ? fmtKm(prevu.distanceM) : null, prevu.allureSKm !== null ? `${prevu.allurePlafond ? "max " : ""}${fmtAllure(prevu.allureSKm)}` : null].filter(Boolean).join(" · ")}</div>
        {limite ? <div className="mt-1 font-bold">{limite === "sous" ? "Resté sous la limite d'allure." : "Plus vite que la limite d'allure."}</div> : null}
      </div>
      <button className="btn" onClick={() => setPrevuOuvert(true)}>Détail</button>
    </div>
  ) : null;

  const stravaCard = sur ? (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="title">Sur Strava</h2>
        {sur.labels.length > 0 ? <div className="flex flex-wrap gap-1.5">{sur.labels.map((l) => <span key={l} className="pill">{libelleLabel(l)}</span>)}</div> : null}
      </div>
      <div className="mt-1 font-bold">{sur.nom || "Sans titre"}</div>
      {sur.description ? (
        <details className="mt-2">
          <summary>Description<Chevron /></summary>
          <p className="mb-0 mt-2 whitespace-pre-line">{sur.description}</p>
        </details>
      ) : null}
    </div>
  ) : null;

  const analyseSeance = s.intervalTitle !== null ? histo.analyze(s.id, [], s.laps) : null;
  const remarque = sessionRemark(analyseSeance);
  const jour = dayOf(s);
  // Le dimanche, le bilan de la semaine part au bout de la description ; une récupération faible du matin s'ajoute aussi.
  const semaine = isReviewDay(jour) && s.type.includes("running") ? weekReviewOf(jour, data.seances, analysis, histo) : null;
  const heure = Number(s.startLocal.slice(11, 13));
  const forme = analysis.readinessOn(jour, heure >= 14 ? jour : addDays(jour, -1))?.score ?? null;
  const proposition = texteStravaDe(s, detail?.analysis ?? null, { charge: load, refs, remarque, specialiteChoisie: avecSpe ? stravaPropose(s, detail?.analysis ?? null, refs) : null, semaine: semaine ? weekLines(semaine) : null, recuperation: recoveryLine(forme) });
  const copier = (cle: string, texte: string) => { void navigator.clipboard.writeText(texte).then(() => { setCopie(cle); setTimeout(() => setCopie(null), 1500); }).catch(() => undefined); };
  const analyseCard = analyseSeance ? (
    <details className="card">
      <summary>Analyse de la séance<Chevron /></summary>
      <div className="mt-2.5 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill">{analyseSeance.verdictLabel}</span>
          {analyseSeance.score !== null ? <b className="text-xl font-black">{fmtNum(analyseSeance.score)} / 10</b> : null}
          <span className="sub">note de la séance</span>
        </div>
        {remarque ? <p className="m-0 font-bold">{remarque}</p> : null}
        {analyseSeance.paragraphs.map((p) => <p key={p} className="m-0">{p}</p>)}
        {analyseSeance.sampleSize < 10 ? <p className="sub m-0">Comparaison sur {analyseSeance.sampleSize} séance{analyseSeance.sampleSize > 1 ? "s" : ""} seulement : elle s'affinera avec l'historique.</p> : null}
      </div>
    </details>
  ) : null;

  const texteCard = proposition ? (
    <details className="card">
      <summary>Texte pour Strava<Chevron /></summary>
      <div className="mt-2.5 grid gap-3">
        <div>
          <b className="block text-[13px] font-black uppercase">Titre</b>
          <p className="my-1">{proposition.texte.name}</p>
          <button className="btn" onClick={() => copier("titre", proposition.texte.name)}>{copie === "titre" ? "Copié" : "Copier le titre"}</button>
        </div>
        <div>
          <b className="block text-[13px] font-black uppercase">Description</b>
          <p className="my-1 whitespace-pre-line">{proposition.texte.description}</p>
          <button className="btn" onClick={() => copier("description", proposition.texte.description)}>{copie === "description" ? "Copié" : "Copier la description"}</button>
        </div>
        {proposition.proposee ? <button className="btn" aria-pressed={avecSpe} onClick={() => setAvecSpe((v) => !v)}>{avecSpe ? "Retirer" : "Utiliser"} le titre « Spé {proposition.proposee} »</button> : null}
        {s.intervalTitle && proposition.proposee === null && refs.r5.trim() === "" ? <p className="sub m-0">Ajoute tes records dans Réglages pour obtenir le titre « Spé ».</p> : null}
      </div>
    </details>
  ) : null;

  const toursCard = detail ? (
    <details className="card" open>
      <summary>Tours<span className="ml-auto mr-3"><button className="btn btn-small" onClick={(e) => { e.preventDefault(); setTours(true); }}>Corriger</button></span></summary>
      {doubts.length > 0 ? <div className="mt-2.5 rounded-[10px] border-[length:var(--outline)] border-line bg-yellow px-3 py-2 font-bold text-fill-ink">{doubts[0]} : à vérifier.</div> : null}
      <table className="mt-2.5 w-full border-collapse">
        <tbody>
          {s.laps.map((l, i) => (
            <tr key={i} className="border-b-2 border-track last:border-b-0">
              <td className="whitespace-nowrap px-2 py-1.5">{i + 1}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtMeters(l.distance)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtLong(l.duration)}</td>
              <td className="hidden whitespace-nowrap px-2 py-1.5 min-[1000px]:table-cell">{l.averageHr !== null ? `${Math.round(l.averageHr)} bpm` : "–"}</td>
              <td className="px-2 py-1.5"><span className={`role role-${detail.roles[i]}`}>{ROLE_LABEL[detail.roles[i] ?? "OTHER"]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  ) : null;

  return (
    <div className="grid grid-cols-1 items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[1500px]:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]">
        <div className="min-[1500px]:col-span-2"><Link className="btn btn-main" to="/activites">← Activités</Link></div>
        <div className="card min-[1500px]:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="pill" style={{ background: catVar(s) }}>{cat === "other" ? (sportLabel(s.type) ?? categoryLabel(cat)) : categoryLabel(cat)}</span>
              <h1 className="mb-0 mt-2 text-2xl font-black">{titleOf(s)}</h1>
              <div className="sub">{cap(fmtDayLong(s.startLocal))}, {fmtTime(s.startLocal)}</div>
            </div>
            <button className="btn btn-main" onClick={() => setRessenti(true)}>{feeling?.rpe ? `RPE ${feeling.rpe} · modifier` : "Ajouter le ressenti"}</button>
          </div>
        </div>
        {numbers}
        {prevuCard ? <div className="min-w-0 min-[1500px]:col-span-2">{prevuCard}</div> : null}
        {stravaCard ? <div className="min-w-0 min-[1500px]:col-span-2">{stravaCard}</div> : null}
        {analyseCard ? <div className="min-w-0 min-[1500px]:col-span-2">{analyseCard}</div> : null}
        {texteCard ? <div className="min-w-0 min-[1500px]:col-span-2">{texteCard}</div> : null}
        {toursCard ? <div className="min-w-0">{toursCard}</div> : null}
      </div>

      <aside>
        {week ? (
          <>
            <div className="card hidden min-[1100px]:block">
              <div className="mb-1.5 flex items-baseline justify-between"><h2 className="title">Semaine du {fmtDayMonth(week.start)}</h2><span className="sub">{fmtKmValue(week.km)} km</span></div>
              {week.sessions.map((w) => <SeanceRow key={w.id} s={w} current={w.id === s.id} />)}
            </div>
            <details className="card min-[1100px]:hidden">
              <summary>Semaine du {fmtDayMonth(addDays(weekStart(dayOf(s)), 0))} · {fmtKmValue(week.km)} km<Chevron /></summary>
              <div className="mt-2">{week.sessions.map((w) => <SeanceRow key={w.id} s={w} current={w.id === s.id} />)}</div>
            </details>
          </>
        ) : null}
      </aside>

      {ressenti ? <RessentiModal seance={s} existing={feeling} onClose={() => setRessenti(false)} /> : null}
      {prevuOuvert && prevu ? <PrevuModal evt={prevu} onClose={() => setPrevuOuvert(false)} /> : null}
      {tours ? <ToursModal seance={s} onClose={() => setTours(false)} /> : null}
    </div>
  );
}

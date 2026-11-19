import { useMemo, useState } from "react";
import { healthSummary, type HealthMetric } from "@foulee/core";
import { useData } from "../DataProvider";
import { Courbe } from "../components/Courbe";
import { Modal } from "../components/Modal";
import { Empty } from "../components/ui";

const PERIODES = [7, 30, 90] as const;
const COULEUR: Record<HealthMetric["status"], string> = { good: "var(--c-mint)", normal: "var(--c-yellow)", low: "var(--c-pink)" };

function Indicateur({ m, onOpen }: { m: HealthMetric; onOpen: () => void }) {
  return (
    <button className="card block w-full text-left" onClick={onOpen} aria-label={`${m.label} : ${m.value} ${m.unit ?? ""}, ${m.statusLabel}. Voir le détail`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="title">{m.label}</h2>
        <span className="pill" style={{ background: COULEUR[m.status] }}>{m.statusLabel}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <b className="whitespace-nowrap text-3xl font-black">{m.value}</b>
        {m.unit ? <span className="sub">{m.unit}</span> : null}
      </div>
      <div className="mt-3"><Courbe serie={m.series} band={m.band} inverted={m.inverted} titre={`Tendance : ${m.label}`} /></div>
    </button>
  );
}

/** Santé et forme : cinq indicateurs, chacun répond à une question ; le détail (phrase, écart, courbe agrandie) s'ouvre au clic. */
export function Forme() {
  const { data, analysis, today, loading } = useData();
  const [jours, setJours] = useState<(typeof PERIODES)[number]>(30);
  const [ouvert, setOuvert] = useState<HealthMetric["key"] | null>(null);
  const metriques = useMemo(() => healthSummary(jours, data.seances, data.daily, analysis, today), [jours, data, analysis, today]);
  if (loading) return <p className="sub" role="status">Chargement…</p>;
  const m = metriques.find((x) => x.key === ouvert) ?? null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title text-2xl">Forme</h1>
        <div className="flex gap-1.5" role="group" aria-label="Période">
          {PERIODES.map((p) => <button key={p} className={`btn btn-small ${jours === p ? "btn-main" : ""}`} aria-pressed={jours === p} onClick={() => setJours(p)}>{p} jours</button>)}
        </div>
      </div>
      {metriques.length === 0 ? (
        <div className="mt-4"><Empty>Pas encore de données de ta montre : connecte Garmin dans Réglages, la lecture remplit cet écran.</Empty></div>
      ) : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {metriques.map((x) => <Indicateur key={x.key} m={x} onOpen={() => setOuvert(x.key)} />)}
        </div>
      )}
      {m ? (
        <Modal title={m.label} subtitle={`${m.value} ${m.unit ?? ""} · ${m.statusLabel}`} onClose={() => setOuvert(null)}>
          <div className="mt-2"><Courbe serie={m.series} band={m.band} inverted={m.inverted} hauteur={120} titre={`Tendance sur ${jours} jours : ${m.label}`} /></div>
          {m.delta ? <p className="mb-0 mt-3 font-bold">{m.delta}</p> : null}
          <p className="mb-0 mt-2">{m.sentence}</p>
        </Modal>
      ) : null}
    </>
  );
}

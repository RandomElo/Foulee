import { useMemo, useState } from "react";
import { computeProfile, WEAK_BELOW, type Dimension } from "@foulee/core";
import { useData } from "../DataProvider";
import { Chevron } from "./Chevron";
import { Modal } from "./Modal";

/** Ton profil : une phrase, cinq barres notées sur 100 (la plus basse en rose si elle est vraiment basse), le détail au clic, les observations repliées. */
export function ProfilCoureur() {
  const { data, analysis, today } = useData();
  const profil = useMemo(() => computeProfile(data.seances, data.daily, analysis, today), [data.seances, data.daily, analysis, today]);
  const [ouvert, setOuvert] = useState<Dimension | null>(null);
  if (profil.dimensions.length === 0 && profil.findings.length === 0) return null;
  const points = profil.findings.filter((f) => f.good);
  const surveiller = profil.findings.filter((f) => !f.good);
  return (
    <section className="card" aria-labelledby="h-profil">
      <h2 className="title" id="h-profil">Ton profil</h2>
      {profil.summary ? <p className="mb-0 mt-1">{profil.summary}</p> : null}
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {profil.dimensions.map((d) => (
          <li key={d.label}>
            <button className="grid w-full grid-cols-[110px_1fr_auto] items-center gap-3 text-left" onClick={() => setOuvert(d)} aria-label={`${d.label} : ${d.score} sur 100. Voir le détail`}>
              <b>{d.label}</b>
              <span className="block h-3 overflow-hidden rounded-full border-2 border-line" style={{ background: "var(--c-track)" }}>
                <span className="block h-full" style={{ width: `${d.score}%`, background: d.score < WEAK_BELOW ? "var(--c-pink)" : "var(--c-mint)" }} />
              </span>
              <b className="tabular-nums">{d.score}</b>
            </button>
          </li>
        ))}
      </ul>
      {profil.findings.length > 0 ? (
        <details className="mt-3">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-black uppercase">Observations<Chevron /></summary>
          {points.length > 0 ? <><h3 className="mb-1 mt-3 text-[13px] font-black uppercase">Points forts</h3><ul className="m-0 grid gap-1.5 pl-5">{points.map((f) => <li key={f.title}><b>{f.title}.</b> {f.text}</li>)}</ul></> : null}
          {surveiller.length > 0 ? <><h3 className="mb-1 mt-3 text-[13px] font-black uppercase">À surveiller</h3><ul className="m-0 grid gap-1.5 pl-5">{surveiller.map((f) => <li key={f.title}><b>{f.title}.</b> {f.text}</li>)}</ul></> : null}
        </details>
      ) : null}
      {ouvert ? (
        <Modal title={ouvert.label} subtitle={`${ouvert.score} sur 100`} onClose={() => setOuvert(null)}>
          <p className="mb-0 mt-2 font-bold">{ouvert.detail}</p>
          {ouvert.score < WEAK_BELOW ? <p className="mb-0 mt-2">{ouvert.advice}</p> : null}
          <p className="sub mb-0 mt-2">{ouvert.how}</p>
        </Modal>
      ) : null}
    </section>
  );
}

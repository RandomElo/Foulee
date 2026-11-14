import { useEffect, useState } from "react";
import { ChampsReferences } from "../components/ChampsReferences";
import { REFERENCES_VIDES, verifier, type References } from "../lib/references";
import { ecrireReferences, lireReferences } from "../lib/referencesStockage";
import { texteErreur } from "../lib/format";
import { Chevron } from "../components/Chevron";
import { useData } from "../DataProvider";
import { repo } from "../repo";
import { useTheme } from "../theme/ThemeProvider";
import { Navigateur } from "./Navigateur";
import { Nolio } from "./Nolio";
import { Garmin } from "./Garmin";
import { Strava } from "./Strava";
import type { Family, Mode } from "../theme/themes";

function Group<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="mt-4 first:mt-3">
      <b className="mb-1.5 block text-[13px] font-black uppercase">{label}</b>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onPick(v)}
            className={`rounded-full border-[length:var(--outline)] border-line px-4 py-1.5 text-sm font-extrabold ${value === v ? "bg-yellow text-fill-ink" : "bg-card"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Les références du coureur, modifiables ici ; elles s'enregistrent d'un clic. */
function References() {
  const [refs, setRefs] = useState<References>(REFERENCES_VIDES);
  const [etat, setEtat] = useState<{ ok: boolean; texte: string } | null>(null);
  useEffect(() => { lireReferences().then(setRefs).catch(() => undefined); }, []);
  const faux = Object.keys(verifier(refs)).length > 0;
  return (
    <section className="card" aria-labelledby="h-refs">
      <h2 className="title" id="h-refs">Références</h2>
      <p className="sub mb-3 mt-1">Pour tes allures de course et le titre « Spé » des séances.</p>
      <ChampsReferences valeur={refs} onChange={(r) => { setRefs(r); setEtat(null); }} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-main disabled:opacity-50" disabled={faux}
          onClick={() => ecrireReferences(refs).then(() => setEtat({ ok: true, texte: "Enregistré" })).catch((e) => setEtat({ ok: false, texte: texteErreur(e) }))}>Enregistrer</button>
        {etat ? <span role={etat.ok ? "status" : "alert"} className={`font-bold ${etat.ok ? "" : "text-bad"}`}>{etat.texte}</span> : null}
      </div>
    </section>
  );
}

/** Efface toutes les données locales après une confirmation, puis revient à l'accueil de départ. */
function Recommencer() {
  const { recommencer } = useData();
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <>
      <h3 className="mb-1 mt-4 text-[13px] font-black uppercase">Recommencer de zéro</h3>
      <p className="sub m-0">Efface les séances, la santé, les ressentis, Nolio, Strava, les références et la connexion Garmin de cet ordinateur. Rien n'est supprimé chez Garmin.</p>
      {confirmer ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="alert">
          <b>Tout effacer sur cet ordinateur ?</b>
          <button className="btn btn-main" onClick={() => recommencer().catch((e) => { setErreur(texteErreur(e)); setConfirmer(false); })}>Oui, tout effacer</button>
          <button className="btn" onClick={() => setConfirmer(false)}>Annuler</button>
        </div>
      ) : <button className="btn mt-2" onClick={() => { setErreur(null); setConfirmer(true); }}>Tout effacer et recommencer</button>}
      {erreur ? <p role="alert" className="mb-0 mt-2 font-bold text-bad">{erreur}</p> : null}
    </>
  );
}

/** Profil : trois parties, chacune dans son cadre : les connexions (le plus utile), l'apparence, et les réglages avancés repliés. */
export function Reglages() {
  const { family, mode, set } = useTheme();
  const { data, reload } = useData();
  return (
    <div className="grid grid-cols-1 items-start gap-[18px] min-[1000px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="card" aria-labelledby="h-connexions">
        <h2 className="title" id="h-connexions">Connexions</h2>
        <p className="sub mb-3 mt-1">Tes données restent sur cet ordinateur. Aucun mot de passe n'est gardé.</p>
        <Garmin />
        <Strava />
        <Nolio />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-[18px]">
        <References />

        <section className="card" aria-labelledby="h-apparence">
          <h2 className="title" id="h-apparence">Apparence</h2>
          <Group<Family> label="Style" value={family} options={[["neo", "Néo"], ["foulee", "Foulée"]]} onPick={(v) => set({ family: v })} />
          {family === "neo" ? <p className="sub mb-0 mt-3">Néo est toujours clair, comme sur ton téléphone.</p> : (
            <>
              <Group<Mode> label="Mode" value={mode} options={[["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]]} onPick={(v) => set({ mode: v })} />
              <p className="sub mb-0 mt-3">Automatique suit le réglage de ton système.</p>
            </>
          )}
        </section>

        <details className="card">
          <summary>Avancé<Chevron /></summary>
          <h3 className="mb-1 mt-3 text-[13px] font-black uppercase">Navigateur</h3>
          <Navigateur />
          <Recommencer />
          {import.meta.env.DEV ? (
            <>
              <h3 className="mb-1 mt-4 text-[13px] font-black uppercase">Développement</h3>
              <p className="sub m-0">{data.seances.length} séances en base.</p>
              <button className="btn mt-2" onClick={async () => { await repo.loadDemo(); await reload(); }}>Charger des données de démo</button>
            </>
          ) : null}
        </details>
      </div>
    </div>
  );
}

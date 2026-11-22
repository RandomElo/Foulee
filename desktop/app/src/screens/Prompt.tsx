import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Squelette } from "../components/Squelette";
import { construirePrompt, QUESTIONNAIRE_PAR_DEFAUT, type Modele, type Questionnaire, type Ton } from "@foulee/core";
import { useData } from "../DataProvider";
import { refsNumeriques } from "../lib/texteStrava";

const MODELES: [Modele, string][] = [["bilan", "Bilan"], ["preparation", "Préparer une course"], ["croyances", "Croyance limitante"], ["libre", "Question libre"]];
const TONS: [Ton, string][] = [["direct", "Direct"], ["technique", "Technique"]];
const PERIODES = [14, 28, 56, 90];
const champ = "w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink";

function Choix<T extends string | number>({ label, valeur, options, onPick }: { label: string; valeur: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div>
      <b className="mb-1.5 block text-[13px] font-black uppercase">{label}</b>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={String(v)} aria-pressed={valeur === v} onClick={() => onPick(v)}
            className={`rounded-full border-[length:var(--outline)] border-line px-3.5 py-1 text-sm font-extrabold ${valeur === v ? "bg-yellow text-fill-ink" : "bg-card"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Un petit questionnaire, puis le texte complet à coller dans un chat. Tu le lis en entier avant de le copier : rien ne part de l'appli tout seul. */
export function Prompt() {
  const { data, analysis, today, refs, loading } = useData();
  const [q, setQ] = useState<Questionnaire>(QUESTIONNAIRE_PAR_DEFAUT);
  const [copie, setCopie] = useState(false);
  const maj = (p: Partial<Questionnaire>) => { setQ((x) => ({ ...x, ...p })); setCopie(false); };
  const texte = useMemo(() => {
    const r = refsNumeriques(refs);
    return construirePrompt(q, {
      seances: data.seances, daily: data.daily, analysis, today, references: r,
      ressentis: data.feelings.map((f) => ({ activityId: f.activityId, rpe: f.rpe, legs: f.legs, pain: f.pain, note: f.note })),
      prevus: data.nolio.filter((e) => e.genre === "prevu").map((e) => ({ date: e.date, titre: e.titre, dureeS: e.dureeS, distanceM: e.distanceM })),
    });
  }, [q, data, analysis, today, refs]);
  if (loading) return <Squelette />;
  const copier = () => { void navigator.clipboard.writeText(texte).then(() => setCopie(true)).catch(() => undefined); };
  const avecObjectif = q.modele === "preparation" || q.modele === "croyances";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link className="btn btn-main" to="/reglages">← Profil</Link>
        <h1 className="title text-2xl">Prompt pour une IA</h1>
      </div>
      <p className="sub mb-0 mt-2">Réponds à quelques questions : l'appli prépare un texte avec tes données, sans nom, ni lieu, ni trace GPS. Tu le colles toi-même dans chatgpt.com, claude.ai ou ailleurs.</p>
      <div className="mt-4 grid grid-cols-1 items-start gap-[18px] min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="card grid gap-4" aria-labelledby="h-q">
          <h2 className="title" id="h-q">Ta demande</h2>
          <Choix label="Ce que tu veux" valeur={q.modele} options={MODELES} onPick={(v) => maj({ modele: v })} />
          {q.modele !== "bilan" ? (
            <div>
              <label htmlFor="p-texte" className="mb-1 block text-[13px] font-black uppercase">{q.modele === "preparation" ? "La course" : q.modele === "croyances" ? "La croyance" : "Ta question"}</label>
              <textarea id="p-texte" rows={3} className={champ} value={q.texte} onChange={(e) => maj({ texte: e.target.value })}
                placeholder={q.modele === "preparation" ? "Semi de Paris, 8 mars" : q.modele === "croyances" ? "Je ne passerai jamais sous 17 min au 5 km" : ""} />
            </div>
          ) : null}
          {avecObjectif ? (
            <div>
              <label htmlFor="p-obj" className="mb-1 block text-[13px] font-black uppercase">Objectif</label>
              <input id="p-obj" className={champ} value={q.objectif} onChange={(e) => maj({ objectif: e.target.value })} placeholder="16:30 sur 5 km" />
            </div>
          ) : null}
          <Choix label="Période jointe" valeur={q.jours} options={PERIODES.map((p): [number, string] => [p, `${p} jours`])} onPick={(v) => maj({ jours: v })} />
          <Choix label="Ton de la réponse" valeur={q.ton} options={TONS} onPick={(v) => maj({ ton: v })} />
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-1" checked={q.textesLibres} onChange={(e) => maj({ textesLibres: e.target.checked })} />
            <span><b>Joindre les noms de séances et les commentaires</b><span className="sub block">Adresses e-mail, numéros de téléphone et liens y sont masqués.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-1" checked={q.datesRelatives} onChange={(e) => maj({ datesRelatives: e.target.checked })} />
            <span><b>Remplacer les dates par « J-n »</b><span className="sub block">n jours avant aujourd'hui.</span></span>
          </label>
        </section>
        <section className="card" aria-labelledby="h-apercu">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="title" id="h-apercu">Aperçu complet</h2>
            <button className="btn btn-main" onClick={copier}>{copie ? "Copié" : "Copier"}</button>
          </div>
          <p className="sub mb-2 mt-1">{texte.length} caractères. C'est exactement ce qui sera copié.</p>
          <textarea readOnly aria-label="Texte du prompt" className={`${champ} h-[460px] resize-y font-mono text-[13px]`} value={texte} />
        </section>
      </div>
    </>
  );
}

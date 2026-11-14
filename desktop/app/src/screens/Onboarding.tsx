import { Gauge, Lock, PlugZap, Route as Parcours, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ChampsReferences } from "../components/ChampsReferences";
import { useData } from "../DataProvider";
import { manquantes, REFERENCES_VIDES, verifier, type References } from "../lib/references";
import { ecrireReferences } from "../lib/referencesStockage";
import { texteErreur } from "../lib/format";
import { Garmin } from "./Garmin";

interface Page { icone: LucideIcon; titre: string; intro: string; points: string[] }

const PAGES: Page[] = [
  { icone: Parcours, titre: "Bienvenue dans Foulée", intro: "Ton suivi de course à pied, à partir de ta montre Garmin.",
    points: ["Tes séances et leur analyse, fractionnés compris", "Ta charge d'entraînement et ta forme du jour", "Ton ressenti après chaque séance"] },
  { icone: PlugZap, titre: "Comment ça marche", intro: "Foulée lit tes données sur Garmin Connect, puis calcule tout sur cet ordinateur.",
    points: ["Il faut ton compte Garmin Connect, le même que celui de ta montre", "La première lecture peut prendre quelques minutes", "Strava et Nolio sont facultatifs : tu les ajoutes plus tard dans Profil"] },
  { icone: Lock, titre: "Tes données restent chez toi", intro: "Rien n'est envoyé à un serveur Foulée.",
    points: ["Tout est rangé sur cet ordinateur, dans une base chiffrée", "Ton mot de passe Garmin n'est pas gardé : seul un jeton de session va dans le trousseau de ton système", "Tu peux tout effacer et recommencer depuis Profil"] },
];
const PAGE_REFS = PAGES.length;
const PAGE_GARMIN = PAGES.length + 1;
const DERNIERE = PAGE_GARMIN;

/** Premier lancement : trois écrans courts, tes références, puis la connexion à Garmin. Tout se renseigne ici, en une fois. */
export function Onboarding() {
  const { terminerOnboarding, prenom, data } = useData();
  const [page, setPage] = useState(0);
  const [refs, setRefs] = useState<References>(REFERENCES_VIDES);
  const [prevenu, setPrevenu] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const manque = manquantes(refs);
  const faux = Object.keys(verifier(refs)).length > 0;
  const aller = (p: number) => { setPage(p); setPrevenu(false); setErreur(null); };

  const apresReferences = async () => {
    if (faux) return;
    if (manque.length > 0 && !prevenu) { setPrevenu(true); return; }
    try { await ecrireReferences(refs); aller(PAGE_GARMIN); } catch (e) { setErreur(texteErreur(e)); }
  };
  const terminer = async () => { try { await terminerOnboarding(); } catch (e) { setErreur(texteErreur(e)); } };

  const p = PAGES[page];
  const connecteLu = data.seances.some((s) => s.source === "garmin");
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col justify-center gap-4 p-5 max-[700px]:p-3">
      <section className="card" aria-labelledby="h-onboarding">
        <div className="mb-4 flex items-center justify-between gap-2">
          <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={`Étape ${page + 1} sur ${DERNIERE + 1}`}>
            {Array.from({ length: DERNIERE + 1 }, (_, i) => (
              <li key={i} aria-current={i === page ? "step" : undefined} className={`h-2.5 rounded-full border-[length:var(--outline)] border-line ${i === page ? "w-7 bg-yellow" : i < page ? "w-2.5 bg-ink" : "w-2.5 bg-track"}`} />
            ))}
          </ol>
          {page < PAGE_REFS ? <button className="btn" onClick={() => aller(PAGE_REFS)}>Passer</button> : null}
        </div>

        {p ? (
          <>
            <span className="mb-3 grid size-14 place-items-center rounded-full border-[length:var(--outline)] border-line bg-yellow text-fill-ink"><p.icone size={28} aria-hidden /></span>
            <h2 className="title text-2xl" id="h-onboarding">{p.titre}</h2>
            <p className="sub mb-0 mt-1">{p.intro}</p>
            <ul className="mb-0 mt-4 grid list-none gap-3 p-0">
              {p.points.map((t) => (
                <li key={t} className="flex items-start gap-3"><span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-ink" /><span>{t}</span></li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end"><button className="btn btn-main" onClick={() => aller(page + 1)}>Suivant</button></div>
          </>
        ) : page === PAGE_REFS ? (
          <>
            <span className="mb-3 grid size-14 place-items-center rounded-full border-[length:var(--outline)] border-line bg-yellow text-fill-ink"><Gauge size={28} aria-hidden /></span>
            <h2 className="title text-2xl" id="h-onboarding">Tes références</h2>
            <p className="sub mb-4 mt-1">Elles servent à calculer tes allures de course et le titre « Spé » de tes séances. Tout est facultatif, tu pourras les changer dans Profil.</p>
            <ChampsReferences valeur={refs} onChange={(r) => { setRefs(r); setPrevenu(false); }} />
            {prevenu ? <p role="alert" className="mb-0 mt-4 font-bold">Il manque {manque.join(", ")}. Tu peux les ajouter plus tard, mais en attendant les allures de course, les zones et les titres « Spé » seront moins précis.</p> : null}
            {erreur ? <p role="alert" className="mb-0 mt-3 font-bold text-bad">{erreur}</p> : null}
            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <button className="btn" onClick={() => aller(page - 1)}>Retour</button>
              <button className="btn btn-main disabled:opacity-50" disabled={faux} onClick={() => void apresReferences()}>{prevenu ? "Continuer sans" : "Suivant"}</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="title text-2xl" id="h-onboarding">Connecte ta montre</h2>
            <p className="sub mb-3 mt-1">Ton compte Garmin Connect, le même que sur ton téléphone. La lecture démarre dès la connexion.</p>
            <Garmin ouvert />
            {erreur ? <p role="alert" className="mb-0 mt-3 font-bold text-bad">{erreur}</p> : null}
            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <button className="btn" onClick={() => aller(PAGE_REFS)}>Retour</button>
              <button className={`btn ${connecteLu || prenom ? "btn-main" : ""}`} onClick={() => void terminer()}>{connecteLu ? "Terminer" : "Continuer sans Garmin"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

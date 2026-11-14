import { useCallback, useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { texteErreur } from "../lib/format";
import { resumeBilanStrava, strava, type EtatStrava } from "../strava";

const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/**
 * Strava, lu par le navigateur de l'appli. Tu te connectes toi-même dans une vraie fenêtre : l'appli ne remplit rien et ne garde aucun mot de passe.
 * Lecture seule : le nom, la description et les labels de tes activités. La première lecture est complète (une page toutes les 3 secondes) ; ensuite
 * seules les pages récentes sont relues.
 */
export function Strava() {
  const { reload } = useData();
  const [etat, setEtat] = useState<EtatStrava | null>(null);
  const [occupe, setOccupe] = useState<"connexion" | "lecture" | null>(null);
  const [progres, setProgres] = useState<{ page: number; pages: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(() => { strava.etat().then(setEtat).catch(() => setEtat({ total: 0, dernier: null })); }, []);
  useEffect(charger, [charger]);

  const lire = async (complet: boolean) => {
    setOccupe("lecture"); setMessage(null); setProgres({ page: 0, pages: 0 });
    try { setMessage({ ok: true, texte: resumeBilanStrava(await strava.synchroniser(complet, (page, pages) => setProgres({ page, pages }))) }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    finally { setOccupe(null); setProgres(null); charger(); void reload(); }
  };
  /** Une seule action : la fenêtre de connexion, puis la lecture dès que tu es connecté. */
  const connecter = async () => {
    setOccupe("connexion"); setMessage(null);
    try { await strava.connecter(); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); return; }
    await lire((etat?.total ?? 0) === 0);
  };

  const pct = progres && progres.pages > 0 ? Math.min(100, Math.round((progres.page / progres.pages) * 100)) : 0;
  const premiere = (etat?.total ?? 0) === 0;
  return (
    <section className="card" aria-labelledby="h-strava">
      <h2 className="title" id="h-strava">Strava</h2>
      <p className="sub mb-0 mt-1">Le nom, la description et les labels de tes activités. Lecture seule.</p>
      <p className="m-0 mt-3 font-bold" aria-live="polite">
        {etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} activités, lues le ${etat.dernier ? jour(etat.dernier) : "–"}`}
      </p>
      {occupe === "connexion" ? <p className="sub mb-0 mt-2" role="status">Connecte-toi dans la fenêtre Strava. Elle se ferme toute seule, puis la lecture démarre.</p> : null}
      {occupe === "lecture" && progres ? (
        <div className="mt-3">
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Lecture de Strava"
            className="h-3.5 overflow-hidden rounded-md border-[length:var(--outline)] border-line bg-track">
            <div className="h-full bg-mint" style={{ width: `${pct}%` }} />
          </div>
          <div className="sub mt-1">{progres.pages > 0 ? `Page ${progres.page} sur ${progres.pages}` : "Démarrage…"}{premiere && progres.pages > 20 ? " · première lecture, quelques minutes" : ""}</div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn disabled:opacity-50" disabled={occupe !== null} onClick={connecter}>Se connecter</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={() => lire(premiere)}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => strava.annuler()}>Annuler</button> : null}
      </div>
      {message ? <p role={message.ok ? "status" : "alert"} className={`mb-0 mt-3 font-bold ${message.ok ? "" : "text-bad"}`}>{message.texte}</p> : null}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { nolio, resumeBilan, type EtatNolio } from "../nolio";
import { useData } from "../DataProvider";
import { texteErreur } from "../lib/format";

const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/**
 * Nolio, lu par le navigateur de l'appli. Tu te connectes toi-même dans une vraie fenêtre : l'appli ne remplit rien et ne garde aucun mot de passe.
 * Lecture seule, rien n'est écrit sur Nolio.
 */
export function Nolio() {
  const { reload } = useData();
  const [etat, setEtat] = useState<EtatNolio | null>(null);
  const [occupe, setOccupe] = useState<"connexion" | "lecture" | null>(null);
  const [progres, setProgres] = useState<{ fait: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(() => { nolio.etat().then(setEtat).catch(() => setEtat({ total: 0, dernier: null })); }, []);
  useEffect(charger, [charger]);

  const lire = async () => {
    setOccupe("lecture"); setMessage(null); setProgres({ fait: 0, total: 0 });
    try { setMessage({ ok: true, texte: resumeBilan(await nolio.synchroniser((fait, total) => setProgres({ fait, total }))) }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    finally { setOccupe(null); setProgres(null); charger(); void reload(); }
  };
  /** Une seule action : la fenêtre de connexion, puis la lecture dès que tu es connecté. */
  const connecter = async () => {
    setOccupe("connexion"); setMessage(null);
    try { await nolio.connecter(); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); return; }
    await lire();
  };

  const pct = progres && progres.total > 0 ? Math.min(100, Math.round((progres.fait / progres.total) * 100)) : 0;
  return (
    <section className="card" aria-labelledby="h-nolio">
      <h2 className="title" id="h-nolio">Nolio</h2>
      <p className="sub mb-0 mt-1">Tes séances prévues, réalisées et tes objectifs. Lecture seule.</p>
      <p className="m-0 mt-3 font-bold" aria-live="polite">
        {etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} éléments, lus le ${etat.dernier ? jour(etat.dernier) : "–"}`}
      </p>
      {occupe === "connexion" ? <p className="sub mb-0 mt-2" role="status">Connecte-toi dans la fenêtre Nolio. Elle se ferme toute seule, puis la lecture démarre.</p> : null}
      {occupe === "lecture" && progres ? (
        <div className="mt-3">
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Lecture de Nolio"
            className="h-3.5 overflow-hidden rounded-md border-[length:var(--outline)] border-line bg-track">
            <div className="h-full bg-mint" style={{ width: `${pct}%` }} />
          </div>
          <div className="sub mt-1">{progres.total > 0 ? `Période ${progres.fait} sur ${progres.total}` : "Démarrage…"}</div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn disabled:opacity-50" disabled={occupe !== null} onClick={connecter}>Se connecter</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={lire}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => nolio.annuler()}>Annuler</button> : null}
      </div>
      {message ? <p role={message.ok ? "status" : "alert"} className={`mb-0 mt-3 font-bold ${message.ok ? "" : "text-bad"}`}>{message.texte}</p> : null}
    </section>
  );
}

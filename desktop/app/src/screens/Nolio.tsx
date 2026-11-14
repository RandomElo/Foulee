import { useCallback, useEffect, useState } from "react";
import { nolio, resumeBilan, type EtatNolio } from "../nolio";
import { useData } from "../DataProvider";
import { SourceLigne } from "../components/SourceLigne";
import { texteErreur } from "../lib/format";

const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Nolio, lu par le navigateur de l'appli : tu te connectes toi-même, l'appli ne remplit rien et ne garde aucun mot de passe. Lecture seule. */
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
  const etatTexte = occupe === "connexion" ? "Connecte-toi dans la fenêtre Nolio : elle se ferme toute seule, puis la lecture démarre."
    : etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} éléments, lus le ${etat.dernier ? jour(etat.dernier) : "–"}`;
  return (
    <SourceLigne
      titre="Nolio"
      etat={etatTexte}
      progression={occupe === "lecture" && progres ? { pct, libelle: "Lecture de Nolio", texte: progres.total > 0 ? `Période ${progres.fait} sur ${progres.total}` : "Démarrage…" } : null}
      message={message}
      actions={<>
        <button className="btn disabled:opacity-50" disabled={occupe !== null} onClick={connecter}>Se connecter</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={lire}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => nolio.annuler()}>Annuler</button> : null}
      </>}
    />
  );
}

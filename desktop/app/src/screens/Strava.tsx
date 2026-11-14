import { useCallback, useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { SourceLigne } from "../components/SourceLigne";
import { texteErreur } from "../lib/format";
import { resumeBilanStrava, strava, type EtatStrava } from "../strava";

const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Strava, lu par le navigateur de l'appli : tu te connectes toi-même. Lecture seule ; la première lecture est complète (une page toutes les 3 secondes), ensuite seules les pages récentes sont relues. */
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
  const etatTexte = occupe === "connexion" ? "Connecte-toi dans la fenêtre Strava : elle se ferme toute seule, puis la lecture démarre."
    : etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} activités, lues le ${etat.dernier ? jour(etat.dernier) : "–"}`;
  return (
    <SourceLigne
      titre="Strava"
      etat={etatTexte}
      progression={occupe === "lecture" && progres ? { pct, libelle: "Lecture de Strava", texte: `${progres.pages > 0 ? `Page ${progres.page} sur ${progres.pages}` : "Démarrage…"}${premiere && progres.pages > 20 ? " · première lecture, quelques minutes" : ""}` } : null}
      message={message}
      actions={<>
        <button className="btn disabled:opacity-50" disabled={occupe !== null} onClick={connecter}>Se connecter</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={() => lire(premiere)}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => strava.annuler()}>Annuler</button> : null}
      </>}
    />
  );
}

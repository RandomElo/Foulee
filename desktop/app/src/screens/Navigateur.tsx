import { useCallback, useEffect, useState } from "react";
import { navigateur, type EtatNavigateur } from "../navigateur";

const mo = (o: number) => `${Math.round(o / 1e6)} Mo`;

/**
 * Le navigateur que l'appli pilote (sans fenêtre) pour lire Nolio et Strava. Un Chromium installé est utilisé d'abord ; sinon, ou si tu préfères
 * une copie à part, l'appli peut télécharger Chrome for Testing (vérifié par empreinte). Rien ne tourne en dehors d'une synchronisation.
 */
export function Navigateur() {
  const [etat, setEtat] = useState<EtatNavigateur | null>(null);
  const [progres, setProgres] = useState<{ recus: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [occupe, setOccupe] = useState<"telecharge" | "test" | null>(null);

  const charger = useCallback(() => { navigateur.etat().then(setEtat).catch((e) => setMessage({ ok: false, texte: String(e) })); }, []);
  useEffect(charger, [charger]);

  const telecharger = async () => {
    setOccupe("telecharge"); setMessage(null); setProgres({ recus: 0, total: etat?.taille_telechargement ?? 0 });
    try {
      await navigateur.telecharger((recus, total) => setProgres({ recus, total }));
      setMessage({ ok: true, texte: "Chrome for Testing est installé et vérifié." });
    } catch (e) {
      setMessage({ ok: false, texte: String(e) });
    } finally { setOccupe(null); setProgres(null); charger(); }
  };
  const tester = async () => {
    setOccupe("test"); setMessage(null);
    try { setMessage({ ok: true, texte: `Ça marche : ${await navigateur.tester()}.` }); }
    catch (e) { setMessage({ ok: false, texte: String(e) }); }
    finally { setOccupe(null); }
  };

  const pct = progres && progres.total > 0 ? Math.min(100, Math.round((progres.recus / progres.total) * 100)) : 0;
  return (
    <section className="card" aria-labelledby="h-nav">
      <h2 className="title" id="h-nav">Navigateur</h2>
      <p className="sub mb-0 mt-1">Piloté sans fenêtre, seulement pendant une synchronisation de Nolio ou de Strava.</p>
      {etat ? (
        <div className="mt-3">
          <p className="m-0 font-bold">
            {etat.choisi ? `Utilisé : ${etat.choisi.nom}` : "Aucun navigateur disponible"}
          </p>
          {etat.installes.length > 0 ? <p className="sub m-0">Installés : {etat.installes.map((d) => d.nom).join(", ")}</p> : null}
          {occupe === "telecharge" && progres ? (
            <div className="mt-3">
              <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Téléchargement"
                className="h-3.5 overflow-hidden rounded-md border-[length:var(--outline)] border-line bg-track">
                <div className="h-full bg-mint" style={{ width: `${pct}%` }} />
              </div>
              <div className="sub mt-1">{mo(progres.recus)} sur {progres.total > 0 ? mo(progres.total) : "…"}</div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {etat.taille_telechargement !== null && !etat.copie_telechargee && occupe !== "telecharge" ? (
              <button className="btn" onClick={telecharger}>Télécharger Chrome for Testing ({mo(etat.taille_telechargement)})</button>
            ) : null}
            {occupe === "telecharge" ? <button className="btn" onClick={() => navigateur.annuler()}>Annuler</button> : null}
            <button className="btn btn-main disabled:opacity-50" disabled={!etat.choisi || occupe !== null} onClick={tester}>{occupe === "test" ? "Test…" : "Tester"}</button>
          </div>
          {etat.choisi === null && etat.taille_telechargement !== null ? <p className="sub mb-0 mt-2">Téléchargé depuis le site officiel de Chrome for Testing, version {etat.version_epinglee}, vérifié par empreinte SHA-256.</p> : null}
        </div>
      ) : <p className="sub mt-3" role="status">Recherche…</p>}
      {message ? <p role={message.ok ? "status" : "alert"} className={`mb-0 mt-3 font-bold ${message.ok ? "" : "text-bad"}`}>{message.texte}</p> : null}
    </section>
  );
}

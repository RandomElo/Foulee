import { useCallback, useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { SourceLigne } from "../components/SourceLigne";
import { texteErreur } from "../lib/format";
import { phraseAttente, useNavigateurPris } from "../lib/navigateurAttente";
import { resumeBilanStrava, strava, type EtatStrava } from "../strava";

const champ = "w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink";
const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Strava, lu par le navigateur de l'appli : e-mail puis code reçu par e-mail (la connexion Google est refusée par Google dans un navigateur piloté). Lecture seule ; la première lecture est complète (une page toutes les 3 secondes), ensuite seules les pages récentes sont relues. */
export function Strava() {
  const { reload } = useData();
  const attente = phraseAttente(useNavigateurPris(), "Strava");
  const [etat, setEtat] = useState<EtatStrava | null>(null);
  const [occupe, setOccupe] = useState<"connexion" | "lecture" | null>(null);
  const [progres, setProgres] = useState<{ page: number; pages: number } | null>(null);
  const [formulaire, setFormulaire] = useState<"email" | "code" | null>(null);
  const [saisie, setSaisie] = useState({ email: "", code: "" });
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(() => { strava.etat().then(setEtat).catch(() => setEtat({ total: 0, dernier: null })); }, []);
  useEffect(charger, [charger]);

  const lire = async (complet: boolean) => {
    setOccupe("lecture"); setMessage(null); setProgres({ page: 0, pages: 0 });
    try { setMessage({ ok: true, texte: resumeBilanStrava(await strava.synchroniser(complet, (page, pages) => setProgres({ page, pages }))) }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    finally { setOccupe(null); setProgres(null); charger(); void reload(); }
  };
  /** Strava refuse les connexions Google depuis un navigateur piloté : l'e-mail, puis le code à usage unique que Strava envoie par e-mail. */
  const apres = async () => { setFormulaire(null); setSaisie({ email: "", code: "" }); setOccupe(null); await lire((etat?.total ?? 0) === 0); };
  const envoyerEmail = async () => {
    setOccupe("connexion"); setMessage(null);
    try {
      if ((await strava.connecter(saisie.email.trim())) === "ok") { await apres(); return; }
      setFormulaire("code"); setOccupe(null);
    } catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); }
  };
  const validerCode = async () => {
    setOccupe("connexion"); setMessage(null);
    try { await strava.envoyerCode(saisie.code); await apres(); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); }
  };
  const fermer = () => { void strava.abandonner(); setFormulaire(null); setMessage(null); };

  const pct = progres && progres.pages > 0 ? Math.min(100, Math.round((progres.page / progres.pages) * 100)) : 0;
  const premiere = (etat?.total ?? 0) === 0;
  const etatTexte = occupe === "connexion" ? (attente ?? "Connexion à Strava… un code va t'arriver par e-mail, saisis-le ici.")
    : etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} activités, lues le ${etat.dernier ? jour(etat.dernier) : "–"}`;
  return (
    <>
    <SourceLigne
      titre="Strava"
      optionnel
      aide="Récupère le nom, la description et les labels de tes activités Strava, pour les afficher avec chaque séance. Lecture seule : rien n'est écrit sur Strava."
      etat={etatTexte}
      progression={occupe === "lecture" && progres ? { pct, libelle: "Lecture de Strava", texte: `${progres.pages > 0 ? `Page ${progres.page} sur ${progres.pages}` : (attente ?? "Démarrage…")}${premiere && progres.pages > 20 ? " · première lecture, quelques minutes" : ""}` } : null}
      message={message}
      actions={<>
        <button className="btn disabled:opacity-50" disabled={occupe !== null} aria-expanded={formulaire !== null} onClick={() => (formulaire ? fermer() : setFormulaire("email"))}>{formulaire ? "Fermer" : "Se connecter"}</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={() => lire(premiere)}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => strava.annuler()}>Annuler</button> : null}
      </>}
    />
    {formulaire === "email" ? (
      <form className="pb-1 pt-3" onSubmit={(e) => { e.preventDefault(); void envoyerEmail(); }}>
        <label htmlFor="strava-email" className="mb-1 block text-[13px] font-black uppercase">E-mail de ton compte Strava</label>
        <input id="strava-email" type="email" value={saisie.email} onChange={(e) => setSaisie((x) => ({ ...x, email: e.target.value }))} autoComplete="username" spellCheck={false} className={champ} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-main disabled:opacity-50" disabled={occupe !== null || !saisie.email.includes("@")}>{occupe === "connexion" ? "Envoi du code…" : "Recevoir le code"}</button>
          <span className="sub">Strava t'envoie un code par e-mail. Pas de mot de passe.</span>
        </div>
      </form>
    ) : null}
    {formulaire === "code" ? (
      <form className="pb-1 pt-3" onSubmit={(e) => { e.preventDefault(); void validerCode(); }}>
        <label htmlFor="strava-code" className="mb-1 block text-[13px] font-black uppercase">Code reçu par e-mail</label>
        <input id="strava-code" inputMode="numeric" value={saisie.code} onChange={(e) => setSaisie((x) => ({ ...x, code: e.target.value }))} autoComplete="one-time-code" spellCheck={false} className={`${champ} max-w-[220px]`} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className="btn btn-main disabled:opacity-50" disabled={occupe !== null || saisie.code.trim() === ""}>{occupe === "connexion" ? "Vérification…" : "Valider"}</button>
          <button type="button" className="btn" disabled={occupe !== null} onClick={() => { void strava.abandonner(); setFormulaire("email"); setMessage(null); }}>Recommencer</button>
        </div>
      </form>
    ) : null}
    </>
  );
}

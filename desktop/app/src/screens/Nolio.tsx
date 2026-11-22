import { useCallback, useEffect, useState } from "react";
import { nolio, optionRpe, resumeBilan, type EtatNolio } from "../nolio";
import { useData } from "../DataProvider";
import { SourceLigne } from "../components/SourceLigne";
import { texteErreur } from "../lib/format";
import { phraseAttente, useNavigateurPris } from "../lib/navigateurAttente";

const champ = "w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink";
const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Nolio, lu par le navigateur de l'appli : tu saisis ton e-mail et ton mot de passe ici ; le mot de passe sert une fois et n'est jamais gardé. Lecture seule. */
export function Nolio() {
  const { reload } = useData();
  const attente = phraseAttente(useNavigateurPris(), "Nolio");
  const [etat, setEtat] = useState<EtatNolio | null>(null);
  const [occupe, setOccupe] = useState<"connexion" | "lecture" | null>(null);
  const [progres, setProgres] = useState<{ fait: number; total: number } | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [saisie, setSaisie] = useState({ email: "", motDePasse: "" });
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [ecritRpe, setEcritRpe] = useState(false);
  useEffect(() => { void optionRpe.lire().then(setEcritRpe); }, []);
  const changerRpe = (actif: boolean) => { setEcritRpe(actif); void optionRpe.ecrire(actif).catch(() => setEcritRpe(!actif)); };

  const charger = useCallback(() => { nolio.etat().then(setEtat).catch(() => setEtat({ total: 0, dernier: null })); }, []);
  useEffect(charger, [charger]);

  const lire = async () => {
    setOccupe("lecture"); setMessage(null); setProgres({ fait: 0, total: 0 });
    try { setMessage({ ok: true, texte: resumeBilan(await nolio.synchroniser((fait, total) => setProgres({ fait, total }))) }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    finally { setProgres({ fait: 0, total: 0 }); charger(); await reload(); setOccupe(null); setProgres(null); }
  };
  /** La connexion, puis la lecture dès qu'elle est faite. Le mot de passe est effacé de l'écran dès l'envoi. */
  const connecter = async () => {
    const { email, motDePasse } = saisie;
    setSaisie({ email, motDePasse: "" }); setOccupe("connexion"); setMessage(null);
    try { await nolio.connecter(email.trim(), motDePasse); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); return; }
    setFormulaire(false); setSaisie({ email: "", motDePasse: "" });
    await lire();
  };

  const pct = progres && progres.total > 0 ? Math.min(100, Math.round((progres.fait / progres.total) * 100)) : 0;
  const etatTexte = occupe === "connexion" ? (attente ?? "Connexion à Nolio…")
    : etat === null ? "Recherche…" : etat.total === 0 ? "Rien de lu pour l'instant" : `${etat.total} éléments, lus le ${etat.dernier ? jour(etat.dernier) : "–"}`;
  return (
    <>
    <SourceLigne
      titre="Nolio"
      optionnel
      aide="Récupère les séances prévues par ton coach, tes objectifs et ses commentaires, pour les afficher dans l'accueil et sur chaque séance. Lecture seule, sauf l'envoi du RPE si tu l'actives plus bas."
      etat={etatTexte}
      progression={occupe === "lecture" && progres ? { pct, libelle: "Lecture de Nolio", texte: progres.total > 0 ? `Période ${progres.fait} sur ${progres.total}` : (attente ?? "Démarrage…") } : null}
      message={message}
      actions={<>
        <button className="btn disabled:opacity-50" disabled={occupe !== null} aria-expanded={formulaire} onClick={() => { setFormulaire((f) => !f); setMessage(null); }}>{formulaire ? "Fermer" : (etat?.total ?? 0) > 0 ? "Se reconnecter" : "Se connecter"}</button>
        <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={lire}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
        {occupe !== null ? <button className="btn" onClick={() => nolio.annuler()}>Annuler</button> : null}
      </>}
    />
    {formulaire ? (
      <form className="pb-1 pt-3" onSubmit={(e) => { e.preventDefault(); void connecter(); }}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
          <div>
            <label htmlFor="nolio-email" className="mb-1 block text-[13px] font-black uppercase">E-mail</label>
            <input id="nolio-email" type="text" value={saisie.email} onChange={(e) => setSaisie((x) => ({ ...x, email: e.target.value }))} autoComplete="username" spellCheck={false} className={champ} />
          </div>
          <div>
            <label htmlFor="nolio-mdp" className="mb-1 block text-[13px] font-black uppercase">Mot de passe</label>
            <input id="nolio-mdp" type="password" value={saisie.motDePasse} onChange={(e) => setSaisie((x) => ({ ...x, motDePasse: e.target.value }))} autoComplete="current-password" className={champ} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-main disabled:opacity-50" disabled={occupe !== null || saisie.email.trim() === "" || saisie.motDePasse === ""}>{occupe === "connexion" ? "Connexion…" : "Se connecter"}</button>
          <span className="sub">Le mot de passe n'est pas gardé.</span>
        </div>
      </form>
    ) : null}
    <label className="mt-3 flex cursor-pointer items-start gap-2">
      <input type="checkbox" className="mt-1" checked={ecritRpe} onChange={(e) => changerRpe(e.target.checked)} />
      <span><b>Envoyer mon RPE à Nolio</b><span className="sub block">Quand tu enregistres un ressenti, l'effort perçu est écrit sur la séance Nolio du même jour. Seul le RPE est modifié.</span></span>
    </label>
    </>
  );
}

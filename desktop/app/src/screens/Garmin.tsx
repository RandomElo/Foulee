import { useCallback, useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { SourceLigne } from "../components/SourceLigne";
import { texteErreur } from "../lib/format";
import { garmin, resumeBilanGarmin, type EtatGarmin } from "../garmin";

const jour = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const champ = "w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink";

/**
 * Garmin Connect : tu saisis ton e-mail et ton mot de passe ici, comme dans l'appli du téléphone. Le mot de passe sert une fois et n'est jamais gardé ;
 * seul un jeton de session est rangé dans le trousseau de ton système. Lecture seule : activités, tours de la montre, sommeil, FC de repos, VFC et prénom.
 * La première lecture est complète (quelques minutes) ; ensuite seules les 20 dernières activités et les jours manquants sont relus.
 */
export function Garmin({ ouvert = false }: { ouvert?: boolean } = {}) {
  const { reload } = useData();
  const [etat, setEtat] = useState<EtatGarmin | null>(null);
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [formulaire, setFormulaire] = useState<"identifiants" | "code" | null>(ouvert ? "identifiants" : null);
  const [saisie, setSaisie] = useState({ email: "", motDePasse: "", code: "" });
  const [methode, setMethode] = useState("email");
  const [occupe, setOccupe] = useState<"connexion" | "lecture" | null>(null);
  const [progres, setProgres] = useState<{ etape: string; fait: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(() => {
    garmin.etat().then(setEtat).catch(() => setEtat({ total: 0, dernier: null }));
    garmin.connecte().then(setConnecte).catch(() => setConnecte(false));
  }, []);
  useEffect(charger, [charger]);

  const lire = async (complet: boolean) => {
    setOccupe("lecture"); setMessage(null); setProgres({ etape: "Démarrage", fait: 0, total: 0 });
    try { setMessage({ ok: true, texte: resumeBilanGarmin(await garmin.synchroniser(complet, (etape, fait, total) => setProgres({ etape, fait, total }))) }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    finally { setOccupe(null); setProgres(null); charger(); void reload(); }
  };

  const premiere = (etat?.total ?? 0) === 0;
  /** La connexion est faite : le mot de passe est effacé de l'écran, puis la lecture démarre. */
  const apresConnexion = async () => {
    setFormulaire(null); setSaisie({ email: "", motDePasse: "", code: "" }); setConnecte(true); setOccupe(null);
    await lire(premiere);
  };
  const seConnecter = async () => {
    setOccupe("connexion"); setMessage(null);
    try {
      const r = await garmin.connecter(saisie.email, saisie.motDePasse);
      if (r.etat === "code") { setMethode(r.methode); setFormulaire("code"); setSaisie((s) => ({ ...s, motDePasse: "" })); setOccupe(null); return; }
      await apresConnexion();
    } catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); }
  };
  const validerCode = async () => {
    setOccupe("connexion"); setMessage(null);
    try { await garmin.envoyerCode(saisie.code); await apresConnexion(); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); setOccupe(null); }
  };
  const deconnecter = async () => {
    try { await garmin.deconnecter(); setMessage({ ok: true, texte: "Déconnecté : le jeton est effacé du trousseau." }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); }
    charger();
  };

  const pct = progres && progres.total > 0 ? Math.min(100, Math.round((progres.fait / progres.total) * 100)) : 0;
  const etatTexte = etat === null || connecte === null ? "Recherche…"
    : !connecte ? (etat.total > 0 ? `${etat.total} activités lues · déconnecté` : "Pas encore connecté")
    : etat.total === 0 ? "Connecté · rien de lu pour l'instant" : `Connecté · ${etat.total} activités, la dernière du ${etat.dernier ? jour(etat.dernier) : "–"}`;
  return (
    <>
      <SourceLigne
        titre="Garmin Connect"
        aide="Récupère tes séances, leurs tours, ton sommeil, ta FC de repos et ton prénom depuis Garmin Connect, pour calculer ta charge et détecter tes fractionnés. Lecture seule : rien n'est écrit sur Garmin. Tu saisis ton e-mail et ton mot de passe une fois : le mot de passe n'est pas gardé, seul un jeton de session va dans le trousseau de ton système."
        etat={etatTexte}
        progression={occupe === "lecture" && progres ? { pct, libelle: "Lecture de Garmin", texte: `${progres.etape}${progres.total > 0 ? ` ${progres.fait} sur ${progres.total}` : ""}${premiere && progres.total > 100 ? " · première lecture, quelques minutes" : ""}` } : null}
        message={message}
        actions={connecte ? (
          <>
            <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} onClick={() => lire(premiere)}>{occupe === "lecture" ? "Lecture…" : "Synchroniser"}</button>
            {occupe === "lecture" ? <button className="btn" onClick={() => garmin.annuler()}>Annuler</button> : <button className="btn" disabled={occupe !== null} onClick={deconnecter}>Déconnecter</button>}
          </>
        ) : (
          ouvert ? null : <button className="btn btn-main disabled:opacity-50" disabled={occupe !== null} aria-expanded={formulaire !== null} onClick={() => setFormulaire((f) => (f ? null : "identifiants"))}>{formulaire ? "Fermer" : "Se connecter"}</button>
        )}
      />
      {!connecte && formulaire === "identifiants" ? (
        <form className="pb-1 pt-3" onSubmit={(e) => { e.preventDefault(); void seConnecter(); }}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
            <div>
              <label htmlFor="garmin-email" className="mb-1 block text-[13px] font-black uppercase">E-mail</label>
              <input id="garmin-email" type="email" value={saisie.email} onChange={(e) => setSaisie((s) => ({ ...s, email: e.target.value }))} autoComplete="username" spellCheck={false} className={champ} />
            </div>
            <div>
              <label htmlFor="garmin-mdp" className="mb-1 block text-[13px] font-black uppercase">Mot de passe</label>
              <input id="garmin-mdp" type="password" value={saisie.motDePasse} onChange={(e) => setSaisie((s) => ({ ...s, motDePasse: e.target.value }))} autoComplete="current-password" className={champ} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-main disabled:opacity-50" disabled={occupe !== null || saisie.email.trim() === "" || saisie.motDePasse === ""}>{occupe === "connexion" ? "Connexion…" : "Se connecter"}</button>
            <span className="sub">Le mot de passe n'est pas gardé.</span>
          </div>
        </form>
      ) : null}
      {!connecte && formulaire === "code" ? (
        <form className="pb-1 pt-3" onSubmit={(e) => { e.preventDefault(); void validerCode(); }}>
          <label htmlFor="garmin-code" className="mb-1 block text-[13px] font-black uppercase">Code de vérification</label>
          <p className="sub mb-2 mt-0">Garmin t'a envoyé un code ({methode === "sms" ? "par SMS" : methode === "email" ? "par e-mail" : methode}).</p>
          <input id="garmin-code" inputMode="numeric" value={saisie.code} onChange={(e) => setSaisie((s) => ({ ...s, code: e.target.value }))} autoComplete="one-time-code" spellCheck={false} className={`${champ} max-w-[220px]`} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className="btn btn-main disabled:opacity-50" disabled={occupe !== null || saisie.code.trim() === ""}>{occupe === "connexion" ? "Vérification…" : "Valider"}</button>
            <button type="button" className="btn" onClick={() => { setFormulaire("identifiants"); setMessage(null); }}>Recommencer</button>
          </div>
        </form>
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { secrets, type SecretName } from "../secrets";
import { texteErreur } from "../lib/format";
import { SourceLigne } from "../components/SourceLigne";

const CHAMPS: { nom: SecretName; label: string; secret: boolean }[] = [
  { nom: "garmin-email", label: "E-mail", secret: false },
  { nom: "garmin-motdepasse", label: "Mot de passe", secret: true },
];

/**
 * Garmin Connect : les identifiants partent directement dans le trousseau de ton système. Ils ne sont ni affichés, ni gardés dans la base,
 * ni dans un fichier, et l'interface ne peut pas les relire (elle sait seulement s'ils sont présents).
 */
export function Sources() {
  const [presents, setPresents] = useState<Partial<Record<SecretName, boolean>>>({});
  const [saisie, setSaisie] = useState<Partial<Record<SecretName, string>>>({});
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const rafraichir = useCallback(async () => {
    const etat: Partial<Record<SecretName, boolean>> = {};
    for (const c of CHAMPS) etat[c.nom] = await secrets.existe(c.nom).catch(() => false);
    setPresents(etat);
  }, []);
  useEffect(() => { void rafraichir(); }, [rafraichir]);

  const enregistrer = async () => {
    setBusy(true); setMessage(null);
    try {
      for (const c of CHAMPS) { const v = saisie[c.nom]?.trim(); if (v) await secrets.definir(c.nom, v); }
      setSaisie({});
      await rafraichir();
      setMessage({ ok: true, texte: "Enregistré dans le trousseau." });
    } catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); } finally { setBusy(false); }
  };
  const retirer = async () => {
    setBusy(true); setMessage(null);
    try { for (const c of CHAMPS) await secrets.supprimer(c.nom); await rafraichir(); setMessage({ ok: true, texte: "Identifiants effacés." }); }
    catch (e) { setMessage({ ok: false, texte: texteErreur(e) }); } finally { setBusy(false); }
  };

  const tous = CHAMPS.every((c) => presents[c.nom]);
  const un = CHAMPS.some((c) => presents[c.nom]);
  const aSaisir = CHAMPS.some((c) => (saisie[c.nom] ?? "").trim() !== "");
  return (
    <>
      <SourceLigne
        titre="Garmin Connect"
        etat={tous ? "Identifiants enregistrés. Lecture bientôt." : un ? "Identifiants incomplets." : "Pas encore configuré."}
        message={message}
        actions={<button className="btn" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>{ouvert ? "Fermer" : tous ? "Modifier" : "Configurer"}</button>}
      />
      {ouvert ? (
        <div className="pb-1 pt-3">
          <p className="sub mb-2 mt-0">Rangés dans le trousseau de ton système : jamais affichés, jamais dans un fichier.</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
            {CHAMPS.map((c) => (
              <div key={c.nom}>
                <label htmlFor={c.nom} className="mb-1 block text-[13px] font-black uppercase">{c.label}</label>
                <input id={c.nom} type={c.secret ? "password" : "text"} value={saisie[c.nom] ?? ""} placeholder={presents[c.nom] ? "Déjà enregistré" : ""}
                  onChange={(e) => setSaisie((x) => ({ ...x, [c.nom]: e.target.value }))} autoComplete="off" spellCheck={false}
                  className="w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-main disabled:opacity-50" disabled={!aSaisir || busy} onClick={enregistrer}>{busy ? "…" : "Enregistrer"}</button>
            {un ? <button className="btn" disabled={busy} onClick={retirer}>Effacer</button> : null}
          </div>
          {import.meta.env.DEV ? <p className="sub mb-0 mt-3">Développement : tu peux aussi les mettre dans desktop/.env (voir .env.example).</p> : null}
        </div>
      ) : null}
    </>
  );
}

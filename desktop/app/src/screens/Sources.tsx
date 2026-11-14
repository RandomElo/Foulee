import { useCallback, useEffect, useState } from "react";
import { secrets, type SecretName } from "../secrets";
import { texteErreur } from "../lib/format";

interface Champ { nom: SecretName; label: string; secret: boolean }
interface Source { id: string; titre: string; aide: string; champs: Champ[] }

const SOURCES: Source[] = [
  { id: "garmin", titre: "Garmin Connect", aide: "Tes séances et ta santé (sommeil, VFC, FC de repos).", champs: [
    { nom: "garmin-email", label: "E-mail", secret: false }, { nom: "garmin-motdepasse", label: "Mot de passe", secret: true } ] },
];

/**
 * Saisie des identifiants des sources. Ils partent directement dans le trousseau de ton système : ils ne sont ni affichés, ni gardés dans la base,
 * ni dans un fichier, et l'interface ne peut pas les relire (elle sait seulement s'ils sont présents).
 */
export function Sources() {
  const [presents, setPresents] = useState<Partial<Record<SecretName, boolean>>>({});
  const [saisie, setSaisie] = useState<Partial<Record<SecretName, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const rafraichir = useCallback(async () => {
    const etat: Partial<Record<SecretName, boolean>> = {};
    for (const s of SOURCES) for (const c of s.champs) etat[c.nom] = await secrets.existe(c.nom).catch(() => false);
    setPresents(etat);
  }, []);
  useEffect(() => { void rafraichir(); }, [rafraichir]);

  const enregistrer = async (s: Source) => {
    setBusy(s.id);
    setMessage(null);
    try {
      for (const c of s.champs) { const v = saisie[c.nom]?.trim(); if (v) await secrets.definir(c.nom, v); }
      setSaisie((x) => { const n = { ...x }; for (const c of s.champs) delete n[c.nom]; return n; });
      await rafraichir();
      setMessage({ ok: true, texte: `${s.titre} : enregistré dans le trousseau.` });
    } catch (e) {
      setMessage({ ok: false, texte: `${s.titre} : ${texteErreur(e)}` });
    } finally { setBusy(null); }
  };
  const retirer = async (s: Source) => {
    setBusy(s.id);
    try { for (const c of s.champs) await secrets.supprimer(c.nom); await rafraichir(); setMessage({ ok: true, texte: `${s.titre} : identifiants effacés.` }); }
    catch (e) { setMessage({ ok: false, texte: `${s.titre} : ${texteErreur(e)}` }); }
    finally { setBusy(null); }
  };

  return (
    <section className="card min-[700px]:col-span-2" aria-labelledby="h-sources">
      <h2 className="title" id="h-sources">Sources</h2>
      <p className="sub mb-0 mt-1">Stockés dans le trousseau de ton système. Jamais affichés, jamais dans un fichier.</p>
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[18px]">
        {SOURCES.map((s) => {
          const tous = s.champs.every((c) => presents[c.nom]);
          const un = s.champs.some((c) => presents[c.nom]);
          const aSaisir = s.champs.some((c) => (saisie[c.nom] ?? "").trim() !== "");
          return (
            <div key={s.id} className="rounded-[10px] border-[length:var(--outline)] border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="font-black uppercase">{s.titre}</b>
                <span className={`pill ${tous ? "!bg-mint" : un ? "" : "!bg-track !text-ink"}`}>{tous ? "Configuré" : un ? "Incomplet" : "Absent"}</span>
              </div>
              <p className="sub mb-2 mt-1">{s.aide}</p>
              {s.champs.map((c) => (
                <div key={c.nom} className="mt-2">
                  <label htmlFor={c.nom} className="mb-1 block text-[13px] font-black uppercase">{c.label}</label>
                  <input id={c.nom} type={c.secret ? "password" : "text"} value={saisie[c.nom] ?? ""} placeholder={presents[c.nom] ? "Déjà enregistré (saisis pour remplacer)" : ""}
                    onChange={(e) => setSaisie((x) => ({ ...x, [c.nom]: e.target.value }))} autoComplete="off" spellCheck={false}
                    className="w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink" />
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-main disabled:opacity-50" disabled={!aSaisir || busy === s.id} onClick={() => enregistrer(s)}>{busy === s.id ? "…" : "Enregistrer"}</button>
                {un ? <button className="btn" disabled={busy === s.id} onClick={() => retirer(s)}>Effacer</button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {message ? <p role={message.ok ? "status" : "alert"} className={`mb-0 mt-3 font-bold ${message.ok ? "" : "text-bad"}`}>{message.texte}</p> : null}
      {import.meta.env.DEV ? <p className="sub mb-0 mt-3">Développement : tu peux aussi les mettre dans desktop/.env (voir .env.example) ; ils sont rangés dans le trousseau au lancement.</p> : null}
    </section>
  );
}

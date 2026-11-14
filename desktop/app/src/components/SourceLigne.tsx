import { Info } from "lucide-react";
import { useId, type ReactNode } from "react";

/**
 * Une ligne de la liste des connexions : le nom et l'état à gauche, les actions à droite, puis la progression et le message dessous.
 * Les lignes d'une même liste sont séparées par un trait, sans cadre propre.
 */
export function SourceLigne({ titre, aide, optionnel = false, etat, actions, progression, message }: {
  titre: string;
  /** Ce que fait la synchronisation, dit au survol (ou au focus clavier) du petit « i ». */
  aide?: string;
  optionnel?: boolean;
  etat: ReactNode;
  actions: ReactNode;
  progression?: { pct: number; texte: string; libelle: string } | null;
  message?: { ok: boolean; texte: string } | null;
}) {
  const idAide = useId();
  return (
    <div className="border-b-2 border-track py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-black uppercase">{titre}</b>
            {optionnel ? <span className="pill !bg-track !text-ink">Optionnel</span> : null}
            {aide ? (
              <span className="group relative inline-flex">
                <button type="button" aria-label={`À quoi sert ${titre}`} aria-describedby={idAide} className="grid size-5 place-items-center rounded-full text-muted hover:text-ink focus-visible:text-ink">
                  <Info size={16} aria-hidden />
                </button>
                <span id={idAide} role="tooltip" className="invisible absolute left-0 top-full z-10 mt-1 w-[min(300px,80vw)] rounded-[10px] border-[length:var(--outline)] border-line bg-card p-3 text-sm font-medium normal-case text-ink shadow-lg group-focus-within:visible group-hover:visible">{aide}</span>
              </span>
            ) : null}
          </div>
          <span className="sub block" aria-live="polite">{etat}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {progression ? (
        <div className="mt-2.5">
          <div role="progressbar" aria-valuenow={progression.pct} aria-valuemin={0} aria-valuemax={100} aria-label={progression.libelle}
            className="h-3 overflow-hidden rounded-md border-[length:var(--outline)] border-line bg-track">
            <div className="h-full bg-mint" style={{ width: `${progression.pct}%` }} />
          </div>
          <div className="sub mt-1">{progression.texte}</div>
        </div>
      ) : null}
      {message ? <p role={message.ok ? "status" : "alert"} className={`mb-0 mt-2 font-bold ${message.ok ? "" : "text-bad"}`}>{message.texte}</p> : null}
    </div>
  );
}

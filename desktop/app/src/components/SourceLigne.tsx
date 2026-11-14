import type { ReactNode } from "react";

/**
 * Une ligne de la liste des connexions : le nom et l'état à gauche, les actions à droite, puis la progression et le message dessous.
 * Les lignes d'une même liste sont séparées par un trait, sans cadre propre.
 */
export function SourceLigne({ titre, etat, actions, progression, message }: {
  titre: string;
  etat: ReactNode;
  actions: ReactNode;
  progression?: { pct: number; texte: string; libelle: string } | null;
  message?: { ok: boolean; texte: string } | null;
}) {
  return (
    <div className="border-b-2 border-track py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <b className="block font-black uppercase">{titre}</b>
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

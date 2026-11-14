import { useEffect, useRef, type ReactNode } from "react";

/** Fenêtre modale : centrée, de taille stable, se ferme avec Échap ou un clic à côté, rend le focus à l'élément qui l'a ouverte. */
export function Modal({ title, subtitle, onClose, children, footer, tall = false }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, [href], input, textarea")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus(); };
  }, [onClose]);
  return (
    <div className="veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${tall ? "modal-tall" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-[length:var(--outline)] border-line px-4 py-3">
          <div className="min-w-0"><h2 className="title">{title}</h2>{subtitle ? <div className="sub mt-1">{subtitle}</div> : null}</div>
          <button className="btn btn-small" onClick={onClose}>Fermer</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2">{children}</div>
        {footer ? <div className="flex flex-wrap justify-between gap-3 border-t-[length:var(--outline)] border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

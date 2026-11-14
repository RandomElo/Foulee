import { useId } from "react";
import { verifier, type References } from "../lib/references";

const champ = "w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink";

function Champ({ label, valeur, exemple, erreur, onChange, mode = "text" }: { label: string; valeur: string; exemple: string; erreur?: string; onChange: (v: string) => void; mode?: "text" | "decimal" | "numeric" }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[13px] font-black uppercase">{label}</label>
      <input id={id} value={valeur} inputMode={mode} placeholder={exemple} spellCheck={false} autoComplete="off" aria-invalid={erreur ? true : undefined}
        onChange={(e) => onChange(e.target.value)} className={champ} />
      {erreur ? <span className="mt-1 block text-sm font-bold text-bad">{erreur}</span> : null}
    </div>
  );
}

/** VMA, records et fréquences cardiaques : tout est facultatif, une erreur n'apparaît que sur un champ rempli de travers. */
export function ChampsReferences({ valeur, onChange }: { valeur: References; onChange: (r: References) => void }) {
  const e = verifier(valeur);
  const maj = (k: keyof References) => (v: string) => onChange({ ...valeur, [k]: v });
  return (
    <div className="grid gap-4">
      <Champ label="VMA (km/h)" valeur={valeur.vma} exemple="19,2" erreur={e.vma} onChange={maj("vma")} mode="decimal" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,120px),1fr))] gap-3">
        <Champ label="5 km" valeur={valeur.r5} exemple="16:48" erreur={e.r5} onChange={maj("r5")} />
        <Champ label="10 km" valeur={valeur.r10} exemple="37:02" erreur={e.r10} onChange={maj("r10")} />
        <Champ label="Semi" valeur={valeur.semi} exemple="1:23:48" erreur={e.semi} onChange={maj("semi")} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3">
        <Champ label="FC max (bpm)" valeur={valeur.fcMax} exemple="190" erreur={e.fcMax} onChange={maj("fcMax")} mode="numeric" />
        <Champ label="FC repos (bpm)" valeur={valeur.fcRepos} exemple="45" erreur={e.fcRepos} onChange={maj("fcRepos")} mode="numeric" />
      </div>
    </div>
  );
}

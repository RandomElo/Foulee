import { useMemo, useState } from "react";
import { analyze, describeLaps, type LapRole, type RoleOverrides } from "@foulee/core";
import { Modal } from "./Modal";
import { repo, type Seance } from "../repo";
import { useData } from "../DataProvider";
import { fmtLong, fmtMeters } from "../lib/format";

export const ROLE_LABEL: Record<LapRole, string> = { WARMUP: "Échauffement", WORK: "Effort", RECOVERY: "Récup", COOLDOWN: "Retour au calme", OTHER: "Autre" };
const CHOICES: [LapRole, string][] = [["WORK", "Effort"], ["RECOVERY", "Récup"], ["OTHER", "Autre"]];
const bg: Record<string, string> = { WORK: "bg-pink text-fill-ink", RECOVERY: "bg-mint text-fill-ink", OTHER: "bg-track text-ink" };

/** Corriger quel tour est un effort, une récup ou rien : le titre se recalcule en direct, rien n'est gardé avant « Enregistrer ». */
export function ToursModal({ seance, onClose }: { seance: Seance; onClose: () => void }) {
  const { reload } = useData();
  const auto = useMemo(() => describeLaps(seance.laps).roles, [seance.laps]);
  const [overrides, setOverrides] = useState<RoleOverrides>(seance.overrides);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => describeLaps(seance.laps, overrides).roles, [seance.laps, overrides]);
  const live = useMemo(() => analyze(seance.laps, new Map(), overrides), [seance.laps, overrides]);
  const efforts = shown.filter((r) => r === "WORK").length;

  const pick = (i: number, role: LapRole) => setOverrides((o) => o.map((x, k) => (k === i ? (role === auto[i] ? null : role) : x)));
  const save = async () => {
    setSaving(true);
    try {
      await repo.clearRoles(seance.id);
      for (const [i, r] of overrides.entries()) if (r !== null) await repo.setRole(seance.id, i, r);
      await reload();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Modal tall title="Corriger les tours" onClose={onClose}
      subtitle={<span className="mt-1 inline-block rounded-[10px] border-[length:var(--outline)] border-line bg-sky px-3 py-1.5 font-black text-fill-ink" aria-live="polite">{efforts < 2 ? "Il faut au moins 2 efforts" : (live?.title ?? `${efforts} efforts retenus`)}</span>}
      footer={<><button className="btn" onClick={() => setOverrides(seance.laps.map(() => null))}>Remettre la détection</button><button className="btn btn-main disabled:opacity-50" disabled={saving || efforts < 2} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button></>}>
      {seance.laps.map((l, i) => (
        <div key={i} className="grid grid-cols-[28px_1fr] items-center gap-x-2.5 gap-y-1.5 border-b-2 border-track py-2 min-[560px]:grid-cols-[28px_1fr_auto]">
          <b>{i + 1}</b>
          <span className="whitespace-nowrap">{fmtMeters(l.distance)} · {fmtLong(l.duration)} · {l.averageHr !== null ? `${Math.round(l.averageHr)} bpm` : "–"}</span>
          <span role="group" aria-label={`Tour ${i + 1}`} className="col-span-2 inline-flex overflow-hidden rounded-[10px] border-[length:var(--outline)] border-line min-[560px]:col-span-1">
            {CHOICES.map(([r, t]) => (
              <button key={r} aria-pressed={shown[i] === r} onClick={() => pick(i, r)}
                className={`flex-1 border-r-[length:var(--outline)] border-line px-2.5 py-1.5 text-[13px] font-black uppercase last:border-r-0 ${shown[i] === r ? bg[r] : "bg-card"}`}>{t}</button>
            ))}
          </span>
        </div>
      ))}
      {error ? <p role="alert" className="mt-3 font-bold text-bad">Enregistrement impossible : {error}</p> : null}
    </Modal>
  );
}

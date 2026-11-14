import { useState } from "react";
import { Modal } from "./Modal";
import { repo, type Feeling, type Seance } from "../repo";
import { useData } from "../DataProvider";
import { fmtDayLong, cap } from "../lib/format";

const RPE_LABELS = ["", "Très facile", "Facile", "Modéré", "Un peu dur", "Dur", "Difficile", "Très difficile", "Très très dur", "Presque maximal", "Maximal"];

function Choices<T extends number>({ label, value, options, onPick }: { label: string; value: T | null; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="mt-4">
      <b className="mb-1.5 block text-[13px] font-black uppercase">{label}</b>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onPick(v)}
            className={`rounded-full border-[length:var(--outline)] border-line px-3.5 py-1 text-sm font-extrabold ${value === v ? "bg-yellow text-fill-ink" : "bg-card"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export function RessentiModal({ seance, existing, onClose }: { seance: Seance; existing?: Feeling; onClose: () => void }) {
  const { reload } = useData();
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? null);
  const [legs, setLegs] = useState<number | null>(existing?.legs ?? 2);
  const [pain, setPain] = useState<number | null>(existing?.pain ?? 0);
  const [note, setNote] = useState(existing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (rpe === null) return;
    setSaving(true);
    try {
      await repo.saveFeeling({ activityId: seance.id, rpe, legs, pain, note: note.trim(), answeredAt: new Date().toISOString() });
      await reload();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Modal title="Ressenti" subtitle={`${seance.intervalTitle ?? (seance.name || "Séance")}, ${cap(fmtDayLong(seance.startLocal))}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Plus tard</button><button className="btn btn-main disabled:opacity-50" disabled={rpe === null || saving} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button></>}>
      <div className="mt-2">
        <b className="mb-1.5 block text-[13px] font-black uppercase">Effort perçu (RPE)</b>
        <div className="grid grid-cols-10 gap-1" role="group" aria-label="Effort perçu de 1 à 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} aria-pressed={rpe === n} onClick={() => setRpe(n)}
              className={`rounded-lg border-[length:var(--outline)] border-line py-2 font-black ${rpe === n ? "bg-ink text-card" : "bg-card"}`}>{n}</button>
          ))}
        </div>
        <div className="sub mt-1.5" aria-live="polite">{rpe === null ? "Choisis de 1 (très facile) à 10 (maximal)" : `${rpe} : ${RPE_LABELS[rpe]}`}</div>
      </div>
      <Choices label="Jambes" value={legs} options={[[1, "Lourdes"], [2, "Normales"], [3, "Légères"]]} onPick={setLegs} />
      <Choices label="Douleur" value={pain} options={[[0, "Aucune"], [1, "Légère"], [2, "Gênante"]]} onPick={setPain} />
      <div className="mt-4">
        <label htmlFor="note" className="mb-1.5 block text-[13px] font-black uppercase">Note</label>
        <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionnel" rows={3}
          className="min-h-16 w-full resize-y rounded-[10px] border-[length:var(--outline)] border-line bg-card p-2 text-ink" />
      </div>
      {error ? <p role="alert" className="mt-3 font-bold text-bad">Enregistrement impossible : {error}</p> : null}
    </Modal>
  );
}

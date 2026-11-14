import { useData } from "../DataProvider";
import { repo } from "../repo";
import { useTheme } from "../theme/ThemeProvider";
import { Navigateur } from "./Navigateur";
import { Sources } from "./Sources";
import type { Family, Mode } from "../theme/themes";

function Group<T extends string>({ label, value, options, onPick, disabled = false }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="mt-4">
      <b className="mb-1.5 block text-[13px] font-black uppercase">{label}</b>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={v} aria-pressed={value === v} disabled={disabled} onClick={() => onPick(v)}
            className={`rounded-full border-[length:var(--outline)] border-line px-4 py-1.5 text-sm font-extrabold disabled:opacity-50 ${value === v ? "bg-yellow text-fill-ink" : "bg-card"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export function Reglages() {
  const { family, mode, set } = useTheme();
  const { prenom, setPrenom, reload, data } = useData();
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-stretch gap-[18px]">
      <section className="card" aria-labelledby="h-apparence">
        <h2 className="title" id="h-apparence">Apparence</h2>
        <Group<Family> label="Style" value={family} options={[["neo", "Néo"], ["foulee", "Foulée"]]} onPick={(v) => set({ family: v })} />
        <Group<Mode> label="Mode" value={family === "neo" ? ("" as Mode) : mode} options={[["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]]} onPick={(v) => set({ mode: v })} disabled={family === "neo"} />
        <p className="sub mb-0 mt-3">{family === "neo" ? "Néo est toujours clair, comme sur ton téléphone." : "Automatique suit le réglage de ton système."}</p>
      </section>
      <section className="card" aria-labelledby="h-profil">
        <h2 className="title" id="h-profil">Profil</h2>
        <label htmlFor="prenom" className="mb-1.5 mt-4 block text-[13px] font-black uppercase">Prénom</label>
        <input id="prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Ton prénom" autoComplete="off"
          className="w-full rounded-[10px] border-[length:var(--outline)] border-line bg-card px-3 py-2 text-ink" />
      </section>
      <Sources />
      <Navigateur />
      {import.meta.env.DEV ? (
        <section className="card" aria-labelledby="h-dev">
          <h2 className="title" id="h-dev">Développement</h2>
          <p className="sub mt-2">{data.seances.length} séances en base.</p>
          <button className="btn mt-2" onClick={async () => { await repo.loadDemo(); await reload(); }}>Charger des données de démo</button>
        </section>
      ) : null}
    </div>
  );
}

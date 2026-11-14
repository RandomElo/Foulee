import { useData } from "../DataProvider";
import { repo } from "../repo";
import { useTheme } from "../theme/ThemeProvider";
import { Navigateur } from "./Navigateur";
import { Nolio } from "./Nolio";
import { Sources } from "./Sources";
import { Strava } from "./Strava";
import type { Family, Mode } from "../theme/themes";

function Group<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="mt-4 first:mt-3">
      <b className="mb-1.5 block text-[13px] font-black uppercase">{label}</b>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onPick(v)}
            className={`rounded-full border-[length:var(--outline)] border-line px-4 py-1.5 text-sm font-extrabold ${value === v ? "bg-yellow text-fill-ink" : "bg-card"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Profil : trois parties, chacune dans son cadre : les connexions (le plus utile), l'apparence, et les réglages avancés repliés. */
export function Reglages() {
  const { family, mode, set } = useTheme();
  const { data, reload } = useData();
  return (
    <div className="grid grid-cols-1 items-start gap-[18px] min-[1000px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="card" aria-labelledby="h-connexions">
        <h2 className="title" id="h-connexions">Connexions</h2>
        <p className="sub mb-3 mt-1">Tes données restent sur cet ordinateur. Tu te connectes toi-même, rien n'est stocké.</p>
        <Nolio />
        <Strava />
        <Sources />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-[18px]">
        <section className="card" aria-labelledby="h-apparence">
          <h2 className="title" id="h-apparence">Apparence</h2>
          <Group<Family> label="Style" value={family} options={[["neo", "Néo"], ["foulee", "Foulée"]]} onPick={(v) => set({ family: v })} />
          {family === "neo" ? <p className="sub mb-0 mt-3">Néo est toujours clair, comme sur ton téléphone.</p> : (
            <>
              <Group<Mode> label="Mode" value={mode} options={[["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]]} onPick={(v) => set({ mode: v })} />
              <p className="sub mb-0 mt-3">Automatique suit le réglage de ton système.</p>
            </>
          )}
        </section>

        <details className="card">
          <summary>Avancé<span aria-hidden>⌄</span></summary>
          <h3 className="mb-1 mt-3 text-[13px] font-black uppercase">Navigateur</h3>
          <Navigateur />
          {import.meta.env.DEV ? (
            <>
              <h3 className="mb-1 mt-4 text-[13px] font-black uppercase">Développement</h3>
              <p className="sub m-0">{data.seances.length} séances en base.</p>
              <button className="btn mt-2" onClick={async () => { await repo.loadDemo(); await reload(); }}>Charger des données de démo</button>
            </>
          ) : null}
        </details>
      </div>
    </div>
  );
}

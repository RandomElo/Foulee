import type { WeekKm } from "@foulee/core";
import { fmtDayMonth, fmtKmValue } from "../lib/format";

/** Kilomètres par semaine : barres, valeur au-dessus, semaine en cours en pointillés, moyenne des 4 semaines d'avant. Les couleurs viennent du thème. */
export function KmChart({ weeks, onPick }: { weeks: WeekKm[]; onPick?: (weekStart: string) => void }) {
  const W = 720, H = 190, base = 150, top = 24, bw = 56;
  const gap = (W - weeks.length * bw) / (weeks.length + 1);
  const max = Math.max(80, ...weeks.map((w) => w.km));
  const before = weeks.slice(-5, -1);
  const avg = before.length > 0 ? before.reduce((s, w) => s + w.km, 0) / before.length : 0;
  const y = (km: number) => base - (km / max) * (base - top);
  const label = weeks.map((w, i) => (w.current ? "Cette semaine" : i === weeks.length - 2 ? "Semaine dernière" : fmtDayMonth(w.start))).map((l, i) => `${l} ${fmtKmValue(weeks[i]?.km ?? 0)} km`).join(", ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Kilomètres par semaine : ${label}`} className="block h-auto w-full">
      {avg > 0 ? <line x1={0} x2={W} y1={y(avg)} y2={y(avg)} stroke="var(--c-ink)" strokeWidth={2} strokeDasharray="3 5" opacity={0.7} /> : null}
      {weeks.map((w, i) => {
        const x = gap + i * (bw + gap);
        const h = Math.max(2, base - y(w.km));
        return (
          <g key={w.start} role={onPick ? "link" : undefined} tabIndex={onPick ? 0 : undefined} aria-label={onPick ? `Voir la semaine du ${fmtDayMonth(w.start)}, ${fmtKmValue(w.km)} km` : undefined}
            className={onPick ? "cursor-pointer" : undefined} onClick={onPick ? () => onPick(w.start) : undefined}
            onKeyDown={onPick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(w.start); } } : undefined}>
            {/* Zone cliquable : toute la colonne, pas seulement la barre */}
            {onPick ? <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" /> : null}
            <rect x={x} y={base - h} width={bw} height={h} rx={6} fill={w.current ? "var(--bar-cur)" : "var(--bar)"} stroke="var(--c-line)" strokeWidth={3} strokeDasharray={w.current ? "7 5" : undefined} />
            <text x={x + bw / 2} y={base - h - 7} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--c-ink)" stroke="var(--c-page)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{fmtKmValue(w.km)}</text>
            <text x={x + bw / 2} y={base + 20} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--c-muted)">{w.current ? "Cette sem." : fmtDayMonth(w.start)}</text>
          </g>
        );
      })}
    </svg>
  );
}

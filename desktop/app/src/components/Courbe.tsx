/** Une courbe simple (tendance sur une période), sans axes : le dernier point est marqué. `band` dessine une plage normale, `inverted` retourne l'axe (allure : plus bas = mieux). */
export function Courbe({ serie, band, inverted = false, hauteur = 56, titre }: { serie: [string, number | null][]; band?: [number, number]; inverted?: boolean; hauteur?: number; titre: string }) {
  const W = 300;
  const valeurs = serie.map((p) => p[1]).filter((v): v is number => v !== null);
  if (valeurs.length < 2) return <div className="sub" role="img" aria-label={titre}>Pas encore assez de points</div>;
  const bas = Math.min(...valeurs);
  const haut = Math.max(...valeurs);
  const ecart = haut - bas || 1;
  const x = (i: number) => 6 + (serie.length === 1 ? (W - 12) / 2 : (i / (serie.length - 1)) * (W - 12));
  const y = (v: number) => { const t = (v - bas) / ecart; return 4 + (inverted ? t : 1 - t) * (hauteur - 8); };
  let d = "";
  let enCours = false;
  serie.forEach(([, v], i) => {
    if (v === null) { enCours = false; return; }
    d += `${enCours ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    enCours = true;
  });
  const dernier = [...serie.keys()].reverse().find((i) => serie[i]?.[1] !== null) as number;
  const [yb, yh] = band ? ([y(band[1]), y(band[0])].sort((a, b) => a - b) as [number, number]).map((v) => Math.min(hauteur, Math.max(0, v))) as [number, number] : [0, 0];
  return (
    <svg viewBox={`0 0 ${W} ${hauteur}`} role="img" aria-label={titre} className="block h-auto w-full">
      {band && yh - yb > 1 && yh - yb < hauteur * 0.7 ? <rect x="0" y={yb} width={W} height={Math.max(yh - yb, 1)} fill="var(--c-band)" fillOpacity="0.3" /> : null}
      <path d={d} fill="none" stroke="var(--c-ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(dernier)} cy={y(serie[dernier]?.[1] as number)} r="4" fill="var(--c-yellow)" stroke="var(--c-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

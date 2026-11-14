/** Espace insécable : celle des titres et des textes générés (U+00A0), comme côté Android. */
export const NBSP = " ";

/**
 * Équivalent de `Insights.dec` du Kotlin : DecimalFormat « 0.## » en locale française (virgule),
 * arrondi à la moitié paire (comportement par défaut de DecimalFormat), zéros de fin supprimés.
 */
export function dec(value: number, digits = 1): string {
  const f = 10 ** digits;
  const scaled = Math.abs(value) * f;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let n = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  if (n === 0) n = 0;
  const sign = value < 0 && n !== 0 ? "-" : "";
  const entier = Math.floor(n / f);
  const fraction = String(n % f).padStart(digits, "0").replace(/0+$/, "");
  return sign + String(entier) + (fraction ? "," + fraction : "");
}

/** `roundToInt()` de Kotlin = `Math.round` de Java : moitié vers le haut. */
export const roundToInt = (x: number): number => Math.round(x);

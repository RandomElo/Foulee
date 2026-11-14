// Dates ISO « AAAA-MM-JJ » : calculs en UTC pour ne dépendre ni du fuseau ni de l'heure d'été.
const JOUR = 86_400_000;
const parse = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const daysBetween = (a: string, b: string): number => Math.round((parse(b) - parse(a)) / JOUR);
export const addDays = (iso: string, n: number): string => new Date(parse(iso) + n * JOUR).toISOString().slice(0, 10);
/** Date et heure locales « AAAA-MM-JJ HH:MM:SS » en millisecondes (fuseau neutre : seules les différences comptent). */
export const localMillis = (s: string): number => {
  const [d, h = "00:00:00"] = s.replace("T", " ").split(" ");
  const [hh = 0, mm = 0, ss = 0] = h.split(":").map(Number);
  return parse(d as string) + ((hh * 60 + mm) * 60 + ss) * 1000;
};

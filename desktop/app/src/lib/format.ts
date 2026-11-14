// Formats français : espaces insécables entre un nombre et son unité, virgule décimale, dates en UTC pour ne pas glisser d'un jour.
const NB = " ";
const fr = (n: number, d: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const fmtKm = (meters: number | null): string => (meters === null ? "–" : `${fr(meters / 1000, 1)}${NB}km`);
export const fmtKmValue = (km: number): string => fr(km, 1);
export const fmtNum = (n: number, d = 1): string => fr(n, d);

/** 3,54 m/s -> « 4 min 42 / km » */
export function fmtPace(speed: number | null): string {
  if (speed === null || speed <= 0) return "–";
  const s = Math.round(1000 / speed);
  return `${Math.floor(s / 60)}${NB}min${NB}${String(s % 60).padStart(2, "0")}${NB}/${NB}km`;
}

/** 2772 s -> « 46:12 », 3725 s -> « 1:02:05 » */
export function fmtClock(seconds: number | null): string {
  if (seconds === null) return "–";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 370 s -> « 6 min 10 » */
export function fmtLong(seconds: number | null): string {
  if (seconds === null) return "–";
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}${NB}min${NB}${String(s % 60).padStart(2, "0")}` : `${s}${NB}s`;
}

export const fmtMeters = (m: number | null): string => (m === null ? "–" : m >= 3000 ? `${fr(m / 1000, 1)}${NB}km` : `${Math.round(m)}${NB}m`);

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const opt = (o: Intl.DateTimeFormatOptions) => (iso: string) => new Intl.DateTimeFormat("fr-FR", { ...o, timeZone: "UTC" }).format(utc(iso)).replace(/\./g, "");
export const fmtDayShort = opt({ weekday: "short", day: "numeric" });
export const fmtDayLong = opt({ weekday: "long", day: "numeric", month: "long" });
export const fmtDayMonth = opt({ day: "numeric", month: "short" });
export const fmtWeekday1 = (iso: string): string => new Intl.DateTimeFormat("fr-FR", { weekday: "narrow", timeZone: "UTC" }).format(utc(iso)).toUpperCase();
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtTime = (startLocal: string): string => `${Number(startLocal.slice(11, 13))}${NB}h${NB}${startLocal.slice(14, 16)}`;

/** Le texte d'une erreur à montrer : le message d'une `Error` sans son préfixe « Error: », ou la chaîne renvoyée par une commande Tauri. */
export const texteErreur = (e: unknown): string => (e instanceof Error ? e.message : String(e));

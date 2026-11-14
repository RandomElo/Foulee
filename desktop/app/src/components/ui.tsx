import type { ReactNode } from "react";
import { categoryOf, type ActivityRow } from "@foulee/core";

export const catVar = (a: ActivityRow): string => {
  const c = categoryOf(a);
  if (c === "interval" && /seuil|tempo/i.test(a.intervalTitle ?? "")) return "var(--cat-threshold)";
  return `var(--cat-${c === "strength" ? "other" : c})`;
};

export function Dot({ a }: { a: ActivityRow }) {
  return <i aria-hidden className="mt-1 block size-3.5 shrink-0 rounded-full border-2 border-line" style={{ background: catVar(a) }} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card sub">{children}</div>;
}

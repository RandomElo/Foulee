import { createMemoryRepo } from "./memory";
import { tauriRepo } from "./tauri";
import type { Repo } from "./types";

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Dans l'application : la base chiffrée. Dans un navigateur (développement seulement) : la mémoire avec des données de démonstration. */
export const repo: Repo = dansTauri ? tauriRepo : import.meta.env.DEV ? createMemoryRepo() : tauriRepo;
export type { Donnees, Feeling, Repo, Seance } from "./types";

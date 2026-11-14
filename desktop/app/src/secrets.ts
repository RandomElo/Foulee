import { invoke } from "@tauri-apps/api/core";

/** Les secrets sont dans le trousseau du système, côté Rust. L'interface peut en écrire, tester la présence et effacer : jamais relire. */
export type SecretName = "garmin-email" | "garmin-motdepasse" | "nolio-cle";

interface Secrets {
  definir(nom: SecretName, valeur: string): Promise<void>;
  existe(nom: SecretName): Promise<boolean>;
  supprimer(nom: SecretName): Promise<void>;
}

const tauri: Secrets = {
  definir: (nom, valeur) => invoke("secret_definir", { nom, valeur }),
  existe: (nom) => invoke<boolean>("secret_existe", { nom }),
  supprimer: (nom) => invoke("secret_supprimer", { nom }),
};

/** Navigateur (développement seulement) : on retient seulement qu'un secret a été saisi, jamais sa valeur. */
function memoire(): Secrets {
  const presents = new Set<SecretName>();
  return {
    async definir(nom) { presents.add(nom); },
    async existe(nom) { return presents.has(nom); },
    async supprimer(nom) { presents.delete(nom); },
  };
}

const dansTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const secrets: Secrets = dansTauri ? tauri : import.meta.env.DEV ? memoire() : tauri;

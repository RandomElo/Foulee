import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Activity } from "lucide-react";
import { SCHEMA_VERSION } from "@foulee/core";
import { infos } from "./db";

function Accueil() {
  const [etat, setEtat] = useState<string>("Ouverture de la base…");

  useEffect(() => {
    infos()
      .then(([sqlite, cipher]) => setEtat(`Base chiffrée prête (SQLite ${sqlite}, SQLCipher ${cipher}, schéma ${SCHEMA_VERSION})`))
      .catch((e) => setEtat(`Base inaccessible : ${String(e)}`));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-3xl font-black uppercase">
        <Activity /> Foulée
      </h1>
      <p className="mt-4 rounded-xl border-[3px] border-black bg-white p-4 shadow-[4px_4px_0_#111]">{etat}</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<Accueil />} />
    </Routes>
  );
}

import { CircleUser, Footprints, HeartPulse, House, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useData } from "./DataProvider";
import { relancer, useMiseAJour } from "./maj";
import { Accueil } from "./screens/Accueil";
import { Activites } from "./screens/Activites";
import { Fiche } from "./screens/Fiche";
import { Onboarding } from "./screens/Onboarding";
import { Reglages } from "./screens/Reglages";

/** Le logo de l'appli (carré arrondi, tracé en M), repris de android/.../logo_neo.xml ; les couleurs suivent le thème. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden>
      <path d="M8 0h16a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V8a8 8 0 0 1 8-8z" fill="#2A2A2A" />
      <path d="M8 22l5-12 4 8 3-5 4 9" fill="none" stroke="#F7D774" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Un changement d'écran repart toujours du haut de la page (le retour arrière aussi : jamais un écran vu à mi-hauteur). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Forme() {
  return <div className="card"><h2 className="title">Forme</h2><p className="sub mb-0 mt-2">Sommeil, VFC, FC de repos et charge : écran à venir.</p></div>;
}

export default function App() {
  const { prenom, data, onboarde } = useData();
  const majDispo = useMiseAJour();
  const demo = data.seances.length > 0 && data.seances.every((s) => s.source === "demo");
  const tabs = [
    { to: "/", label: "Accueil", icon: House, end: true },
    { to: "/activites", label: "Activités", icon: Footprints, end: false },
    { to: "/forme", label: "Forme", icon: HeartPulse, end: false },
    { to: "/reglages", label: prenom || "Profil", icon: CircleUser, end: false },
  ];
  if (onboarde === null) return <div className="p-5" role="status">Chargement…</div>;
  if (!onboarde) return <main className="flex min-h-full flex-col"><Onboarding /></main>;
  return (
    <div className="flex min-h-full flex-col">
      <header className="band flex flex-wrap items-center gap-1.5 px-4 py-2.5">
        <div className="mr-3 flex items-center gap-2 text-lg font-black uppercase max-[700px]:mr-0"><Logo />Foulée</div>
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="tab"><Icon size={20} aria-hidden /><span className="max-[700px]:hidden">{label}</span></NavLink>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {majDispo ? <button className="btn btn-main whitespace-nowrap" onClick={() => void relancer()}><RefreshCw size={16} aria-hidden className="mr-1.5 inline" />Mettre à jour</button> : null}
          {demo ? <span className="pill !bg-card !text-ink">Données de démo</span> : data.seances.length === 0 ? <span className="pill">Aucune source</span> : null}
        </div>
      </header>
      <main className="flex-1 p-5 max-[700px]:p-3">
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Accueil />} />
          <Route path="/activites" element={<Activites />} />
          <Route path="/activites/:id" element={<Fiche />} />
          <Route path="/forme" element={<Forme />} />
          <Route path="/reglages" element={<Reglages />} />
          <Route path="*" element={<Accueil />} />
        </Routes>
      </main>
    </div>
  );
}

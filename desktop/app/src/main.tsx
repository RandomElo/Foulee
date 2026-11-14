import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { DataProvider } from "./DataProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";

// Le contour de focus ne s'affiche qu'au clavier : la touche qui navigue l'active, un clic de souris ou un toucher le coupe.
document.addEventListener("keydown", (e) => { if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(e.key)) document.documentElement.dataset.input = "keyboard"; }, true);
document.addEventListener("pointerdown", () => { document.documentElement.dataset.input = "pointer"; }, true);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* HashRouter : fonctionne à l'identique sous les protocoles tauri:// de chaque système. */}
    <HashRouter>
      <ThemeProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>,
);

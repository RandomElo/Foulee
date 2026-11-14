import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { DataProvider } from "./DataProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";

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

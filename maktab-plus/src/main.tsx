import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./lib/store";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

// Apply the saved theme before first paint to avoid a flash.
try {
  const saved = localStorage.getItem("maktab.theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </I18nProvider>
  </StrictMode>,
);

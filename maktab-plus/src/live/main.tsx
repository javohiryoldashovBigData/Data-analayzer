import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LiveApp from "./LiveApp";
import "../styles.css";

try {
  const saved = localStorage.getItem("maktab.theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(<StrictMode><LiveApp /></StrictMode>);

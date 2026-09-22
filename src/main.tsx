import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource/zen-kaku-gothic-new/900.css";
import App from "./App";
import { detectLocale } from "./i18n";

// The document language follows the UI language (WCAG 3.1.1).
document.documentElement.lang = detectLocale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

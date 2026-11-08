import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startFonts } from "./fonts";
import { start } from "./sync";
import { startTheme } from "./theme";
import "./styles.css";

startTheme();
startFonts(); // TEMPORARY font tester (Settings › Experimental)
start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

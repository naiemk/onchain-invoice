import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./globals.css";
import "./legacy-bridge.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

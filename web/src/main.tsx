import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for web push
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("SW registered:", reg.scope);
      })
      .catch((err) => {
        console.warn("SW registration failed:", err);
      });
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";

function App() {
  const [health, setHealth] = useState("…");
  useEffect(() => {
    api<{ ok: boolean; version: string }>("/api/health")
      .then((h) => setHealth(`ok ${h.version}`))
      .catch((e: unknown) => setHealth(String(e)));
  }, []);
  return <h1>Apprentice — {health}</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

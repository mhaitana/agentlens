import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>AgentLens</h1>
      <p>Local workflow intelligence for Claude Code.</p>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

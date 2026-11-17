import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const root = createRoot(document.getElementById("root"));

if (import.meta.env.DEV) {
  import("builderharness/react").then(({ BuilderHarnessRoot }) => {
    root.render(
      <StrictMode>
        <BuilderHarnessRoot>
          <App />
        </BuilderHarnessRoot>
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

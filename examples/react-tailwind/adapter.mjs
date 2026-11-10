import path from "node:path";
import { fileURLToPath } from "node:url";
import reactVite, { listSourceFiles } from "../../pipeline/adapters/react-vite.mjs";
import { ROUTES } from "./src/config/frs-map.js";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const kitRoot = path.resolve(appRoot, "../..");
const specView = path.join(appRoot, "src/components/SpecView.jsx");
const sharedDirectories = ["build", "client", "ui-spec/impl/react"];

export default {
  ...reactVite,
  async resolveRoute(repoRoot, route) {
    if (!Object.values(ROUTES).includes(route)) return [];
    // The business views share App.jsx. The UI spec is a separate lazy module.
    const appSources = await reactVite.resolveRoute(repoRoot);
    const sharedSources = await Promise.all(sharedDirectories.map((directory) => listSourceFiles(path.join(kitRoot, directory))));
    const configSources = [
      "vite.mjs", "package-lock.json", "pipeline/adapters/react-vite.mjs", "ui-spec/tokens.css", "ui-spec/tokens.json",
    ].map((file) => path.join(kitRoot, file)).concat(
      ["adapter.mjs", "postcss.config.cjs", "tailwind.config.cjs"].map((file) => path.join(appRoot, file)),
    );
    const sources = appSources.filter((file) => route === ROUTES.uiSpec || path.resolve(repoRoot, file) !== specView);
    return sources.concat([...configSources, ...sharedSources.flat()].map((file) => path.relative(repoRoot, file)));
  },
};

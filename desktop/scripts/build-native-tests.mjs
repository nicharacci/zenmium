import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Build only: main coordinates Electron launches alongside UI verification.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtins = new Set(builtinModules);
await build({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(desktop, "tests/native-core.ts"),
      fileName: () => "native-tests.js",
      formats: ["es"],
    },
    minify: false,
    outDir: resolve(desktop, "out/verify"),
    rollupOptions: {
      external: (id) =>
        id === "electron" || id.startsWith("node:") || builtins.has(id),
    },
    target: "node22",
  },
  configFile: false,
  root: desktop,
});
console.log("Built without launching Electron. From desktop, run:");
console.log(
  "env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron out/verify/native-tests.js"
);

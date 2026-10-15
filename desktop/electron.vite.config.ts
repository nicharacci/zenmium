import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: { input: resolve(__dirname, "src/main/index.ts") },
    },
    resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          tab: resolve(__dirname, "src/preload/tab.ts"),
        },
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
    resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  },
  renderer: {
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
        "@renderer": resolve(__dirname, "src/renderer"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    root: resolve(__dirname, "src/renderer"),
  },
});

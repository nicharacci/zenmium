import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: { outDir: "out/main", rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
    resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  },
  preload: {
    build: { outDir: "out/preload", rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") } },
    resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer"),
        "@shared": resolve(__dirname, "src/shared"),
        "@": resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "web/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "web/index.html"),
        sw: resolve(__dirname, "web/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          // Service worker must be at the root with a known name
          if (chunk.name === "sw") return "sw.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});

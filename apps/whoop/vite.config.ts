import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "web",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { charts: ["recharts"] },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/auth": "http://127.0.0.1:3100",
      "/callback": "http://127.0.0.1:3100",
    },
  },
});

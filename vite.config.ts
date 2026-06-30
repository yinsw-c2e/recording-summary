import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      ignored: ["**/.venv-whisper/**", "**/data/**"]
    },
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  build: {
    outDir: "dist"
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy de /api para o backend em :3001 durante o desenvolvimento.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});

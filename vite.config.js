import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expõe na rede local (acesso pelo celular)
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});

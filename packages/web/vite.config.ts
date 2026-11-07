import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The server reads the repo-root .env, so the proxy follows its PORT too.
  const env = { ...loadEnv(mode, "../..", ""), ...process.env };
  return {
    plugins: [react()],
    server: {
      // Reachable from the phone on the LAN during development.
      host: true,
      port: 5175,
      proxy: {
        "/api": env.EVENKEEL_API ?? `http://localhost:${env.PORT ?? 8789}`,
      },
    },
  };
});

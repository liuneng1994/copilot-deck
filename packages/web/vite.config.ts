import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = Number(process.env.AGENT_VIEW_SERVER_PORT ?? 4000);
const webPort = Number(process.env.AGENT_VIEW_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});

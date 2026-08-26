import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_TAGLINE } from "../server/src/lib/brand.ts";

const IS_DEMO = process.env.VITE_APP_DEMO === "1";

const plugins: PluginOption[] = [react()];
if (!IS_DEMO) {
  plugins.push(
    ...(VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "brand/favicon-16.png", "brand/favicon-32.png", "brand/icon-192.png", "brand/icon-512.png", "brand/icon-512-maskable.png"],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "es",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/brand/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }) as PluginOption[]),
  );
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@attachment-policy": path.resolve(__dirname, "../server/src/lib/attachment-policy.ts"),
      "@brand": path.resolve(__dirname, "../server/src/lib/brand.ts"),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});

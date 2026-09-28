import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_TAGLINE, APP_VERSION } from "../server/src/lib/brand.ts";

const IS_DEMO = process.env.VITE_APP_DEMO === "1";

/**
 * The sandboxed visualizer frame must not register the service worker: it runs
 * on an opaque origin where that is impossible, and its CSP (deliberately
 * without 'unsafe-inline') would only log a violation for it.
 */
const stripWorkerFromFrame: PluginOption = {
  name: "dayly:strip-sw-from-visualizer-frame",
  enforce: "post",
  transformIndexHtml: {
    order: "post",
    handler(html: string, ctx: { filename: string }) {
      if (!ctx.filename.replaceAll("\\", "/").endsWith("visualizer-frame.html")) return html;
      return html
        .replace(/<script id="vite-plugin-pwa:inline-sw">[\s\S]*?<\/script>/g, "")
        // Its `default-src 'none'` blocks the manifest anyway; asking for it
        // would only log a violation.
        .replace(/<link rel="manifest"[^>]*>/g, "");
    },
  },
};

const plugins: PluginOption[] = [react()];
if (!IS_DEMO) {
  plugins.push(
    ...(VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      filename: `sw-${APP_VERSION}.js`,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "brand/favicon-16.png", "brand/favicon-32.png", "brand/icon-192.png", "brand/icon-512.png", "brand/icon-512-maskable.png"],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
        theme_color: "#ededeb",
        background_color: "#ededeb",
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
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // The visualizer only runs inside the Windows wrapper; precaching its
        // ~850 KB for every phone and browser would be dead weight.
        globIgnores: ["**/butterchurn*.js", "**/visualizer-frame*.js", "**/visualizer-frame.html"],
        navigateFallback: "/index.html",
        // The sandboxed frame must reach the network: serving index.html here
        // would load the whole app inside the iframe, and a precached copy
        // would replay stale CSP headers.
        navigateFallbackDenylist: [/^\/api\//, /^\/visualizer-frame\.html$/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }) as PluginOption[]),
    stripWorkerFromFrame,
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
    rollupOptions: {
      input: {
        // The visualizer is a second document on purpose: it needs
        // 'unsafe-eval' for MilkDrop presets and is embedded sandboxed, so
        // that permission never reaches the application origin.
        main: path.resolve(__dirname, "index.html"),
        "visualizer-frame": path.resolve(__dirname, "visualizer-frame.html"),
      },
    },
  },
});

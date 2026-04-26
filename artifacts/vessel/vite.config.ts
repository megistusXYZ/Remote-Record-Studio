import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const rawBasePath = process.env.BASE_PATH;

if (!rawBasePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Always end with a single trailing slash so that `${basePath}index.html`
// resolves cleanly regardless of what BASE_PATH was passed in as ("/", "/foo",
// "/foo/" all become "/foo/").
const basePath = rawBasePath.endsWith("/") ? rawBasePath : `${rawBasePath}/`;

// Headers required for advanced web platform features (WebCodecs, WebTransport,
// SharedArrayBuffer). `credentialless` is used in dev so the Replit preview
// iframe can still embed third-party resources without CORP headers — switch to
// `require-corp` for the strictest cross-origin isolation in production servers.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy":
    process.env.NODE_ENV === "production" ? "require-corp" : "credentialless",
} as const;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "Vessel — Studio-Quality Remote Recording",
        short_name: "Vessel",
        description:
          "Studio-quality remote recording. Your voice. Your studio. Your files.",
        theme_color: "#080b0f",
        background_color: "#080b0f",
        display: "standalone",
        orientation: "portrait",
        start_url: basePath,
        scope: basePath,
        categories: ["productivity", "music", "utilities"],
        icons: [
          {
            src: `${basePath}pwa-192.png`,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `${basePath}pwa-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `${basePath}pwa-maskable-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Don't cache anything bigger than 4MB so we never blow up the SW cache
        // with recorded media blobs (those are stored separately in the app).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Exclude oversized hero / background art from precache — they load on
        // demand over the network and would otherwise exceed the cache limit.
        globIgnores: ["**/Gemini_Generated_Image_*"],
        navigateFallback: `${basePath}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
      },
      // Disable in dev so the service worker never caches Vite HMR responses.
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: crossOriginIsolationHeaders,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: crossOriginIsolationHeaders,
  },
});

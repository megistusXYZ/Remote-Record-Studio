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

// Security headers applied to every static response served by the Vite dev
// server and the production-style preview server. Designed to be safe by
// default and to give the Vessel web client a strong posture even before a
// CDN/WAF is in front of it.
//
// The Content-Security-Policy ships in REPORT-ONLY mode first (per the
// Task #68 plan). Flip `VESSEL_CSP_ENFORCE=true` to send the enforcing
// header instead — only do that after a week of clean Report-Only telemetry
// so user-supplied storage / signaling origins have time to surface.
//
// `Referrer-Policy: no-referrer` is critical because share-link decryption
// keys live in URL fragments — a referrer leak would compromise them.
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // 'unsafe-inline' on script-src is a temporary concession for the small
  // JSON-LD <script> in index.html. The CSP is Report-Only today so this
  // does not weaken anything in production yet — we'll either move that
  // block to an external file or add a hash before flipping enforce.
  "script-src 'self' 'unsafe-inline'",
  // wss: is needed for signaling channels; https: covers user-chosen storage
  // origins which we cannot enumerate at build time.
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
] as const;
const cspValue = cspDirectives.join("; ");
const cspEnforce =
  (process.env["VESSEL_CSP_ENFORCE"] ?? "false").toLowerCase() === "true";
const cspHeader = cspEnforce
  ? { "Content-Security-Policy": cspValue }
  : { "Content-Security-Policy-Report-Only": cspValue };

const securityHeaders = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  // Permissions-Policy: deny by default for sensors / payments / etc. We
  // do NOT deny camera/microphone/display-capture — the studio needs them.
  "Permissions-Policy": [
    "accelerometer=()",
    "ambient-light-sensor=()",
    "autoplay=(self)",
    "battery=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "midi=()",
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ].join(", "),
  ...cspHeader,
} as const;

const allHeaders = {
  ...crossOriginIsolationHeaders,
  ...securityHeaders,
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
        // Match the hashed filenames Vite emits (e.g. assets/ship-BrxH2_Ho.png).
        globIgnores: [
          "**/{seascape,ship,podcast,pirate-crew,wheelhouse,observation-cabin}-*.png",
        ],
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
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  // ES-module worker output. Required for vite-plugin-pwa: Workbox's
  // registration helper (workbox-window) uses dynamic imports, which Vite's
  // default IIFE worker format cannot represent. Also matches our captions
  // worker, which is already instantiated with `{ type: "module" }`.
  worker: {
    format: "es",
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: allHeaders,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: allHeaders,
  },
});

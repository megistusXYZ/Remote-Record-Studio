// Copy the background-blur runtime from the installed @mediapipe/tasks-vision
// into public/mediapipe/wasm so the site serves it itself (no third-party
// CDN, and the runtime always matches the library version). Runs before
// `dev` and `build`; the copied files are git-ignored.
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The package does not export package.json, so locate it through this
// workspace's node_modules link instead of require.resolve.
const pkgDir = path.resolve(here, "../node_modules/@mediapipe/tasks-vision");
const target = path.resolve(here, "../public/mediapipe/wasm");

await mkdir(target, { recursive: true });
await cp(path.join(pkgDir, "wasm"), target, { recursive: true });
console.log(
  `mediapipe runtime copied to ${path.relative(process.cwd(), target)}`,
);

# Illustration masters

These six hand-drawn PNGs are the source of truth for the decorative
background illustrations that appear behind various Vessel screens at very
low opacity (`opacity: 0.06–0.07`) with `filter: invert(1) grayscale(1)`
and a radial-gradient mask cutoff.

| File | Used on |
| --- | --- |
| `seascape.png` | landing page (How-it-works section), how-it-works page (intro) |
| `ship.png` | landing page (CTA), how-it-works page (feature row) |
| `podcast.png` | landing page (hero band) |
| `pirate-crew.png` | reserved (imported on landing page) |
| `wheelhouse.png` | lobby screen, solo record screen |
| `observation-cabin.png` | vault screen, settings screen |

## Why they live here, not in `src/`

The masters are 7.5–11 MB each (~54 MB total). Shipping them to the
browser would dominate first-paint weight even though they're only ever
rendered as faded, grayscaled, masked decoration. Instead the build
ships AVIF + WebP variants generated from these PNGs (~2 MB total),
located in `artifacts/vessel/src/assets/illustrations/`.

Because the masters live outside `src/`, Vite never bundles them.

## Regenerating the AVIF + WebP variants

After editing or replacing any master:

```bash
pnpm --filter @workspace/vessel run optimize-illustrations
```

This runs `scripts/optimize-illustrations.mjs` (uses `sharp`) and writes
fresh `.avif` + `.webp` files into `src/assets/illustrations/`. Commit
both the master and the regenerated variants together.

## Adding a new illustration

1. Drop the new PNG master into this folder.
2. Run the regenerate command above.
3. Import the generated `.avif` and `.webp` in the use site and render
   via the established `image-set()` pattern — see existing imports for
   examples.

## Removing an illustration

Delete the master from this folder, then delete the corresponding
`.avif` and `.webp` from `src/assets/illustrations/` (the optimization
script does not prune orphaned outputs).

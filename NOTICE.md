# Notices and Third-Party Acknowledgements

Vessel is © Vessel contributors and is licensed under the
[GNU Affero General Public License v3.0 or later](./LICENSE).

This file lists third-party assets bundled with Vessel and the
upstream open-source projects whose work makes Vessel possible.

---

## Bundled assets

### Factory icon (favicon, PWA icons, brand mark)

The line-art factory illustration used as the Vessel favicon, PWA
icons (`pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`,
`apple-touch-icon.png`), and brand mark is derived from a
public-domain SVG sourced from
[SVG Repo](https://www.svgrepo.com/).

- **Source:** SVG Repo
- **Original license:** CC0 / Public Domain (per SVG Repo's terms for
  the source collection used)
- **Modifications:** Recoloured to Vessel's accent palette
  (`#00d4aa` on `#080b0f`), exported at multiple raster sizes for
  PWA / favicon use, and adapted into the maskable PWA icon.

No attribution is legally required for CC0 / public-domain works,
but we credit the source as a courtesy.

---

## Open-source dependencies

Vessel is built on top of a large amount of open-source software.
The full list of runtime and development dependencies, with their
licenses, lives in:

- `package.json` files at the repo root and in each workspace package
  (`artifacts/*`, `lib/*`, `scripts/`).
- `pnpm-lock.yaml` (the resolved dependency graph).
- `node_modules/` after `pnpm install` — each package preserves its
  own `LICENSE` file.

To produce a snapshot of all bundled dependency licenses, you can run
a tool such as
[`license-checker`](https://www.npmjs.com/package/license-checker)
or
[`license-report`](https://www.npmjs.com/package/license-report)
against an installed checkout.

All dependencies are under permissive licenses (MIT, Apache-2.0, BSD,
ISC, or compatible). None impose additional attribution requirements
beyond preserving their own copyright notices, which the package
manager handles automatically.

If you believe a dependency is missing from this notice or has been
attributed incorrectly, please open an issue or a pull request.

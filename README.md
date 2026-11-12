# Pixel Art Studio

A browser-based pixel art and animation editor. It is a static site: everything runs in your browser and projects are stored locally (IndexedDB), so there is no account and no server.

**Live demo:** https://markocrafts.com/pixelartstudio/

## Features

- **Tools:** pencil, eraser, bucket, line, rectangle, ellipse, gradient and dither fill, shading, dither brush, rect/lasso/wand selection, move, text, custom brush, symmetry, pixel-perfect mode, copy/cut/paste (including images from the system clipboard), flips, rotates, canvas resize/scale/crop/trim.
- **Layers:** add, duplicate, reorder, rename, visibility, lock, opacity, 9 blend modes, alpha lock, merge, flatten, image import and reference layers.
- **Palettes:** built-ins, import/export of `.hex`, `.gpl`, `.pal` and `.png`, Lospec slug import, palette extraction, replace color, palette lock, HSV picker.
- **Animation:** timeline with frames and layers, onion skin, tags, preview player (play, ping-pong, tag ranges), GIF export and import, sprite sheet export (+JSON) and import, WebM/MP4 recording where the browser supports it.
- **Projects:** gallery, IndexedDB autosave with crash recovery, `.pxf` save/open, `.aseprite` import, tile mode, custom grid, editable shortcuts, touch gestures, light/dark themes, installable offline PWA.

Not done yet: PNG sequence zip export and animated WebP.

## Development

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev          # Vite dev server
npm test             # unit tests (Vitest)
npm run lint
npm run typecheck
npm run build        # typecheck, then build to dist/
npm run e2e          # Playwright smoke test against the built site
```

The Vite `base` defaults to `/pixelstudio/dist/` (see `vite.config.ts`). To build for another location, pass `--base`, for example:

```sh
npx vite build --base=/ --outDir=dist-root
```

See [DEPLOY.md](DEPLOY.md) for hosting notes.

## Project layout

- `src/core`: pure editing logic (no DOM APIs, unit-testable)
- `src/render`: compositing, viewport, overlays
- `src/ui`: panels, toolbar, input handling
- `src/io`: PNG, GIF, sprite sheet, Aseprite and `.pxf` import/export
- `src/storage`: IndexedDB and autosave
- `tests/`, `e2e/`: unit and browser tests

Open the page with `?debug` to expose `window.__editor` in the console.

## License

[MIT](LICENSE)

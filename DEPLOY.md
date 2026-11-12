# Deploying

Pixel Art Studio builds to a static `dist/` folder. Node is only needed at build time; any static web server will do.

## Build

```sh
npm ci
npm run lint && npm test
npm run build            # output in dist/, Vite base /pixelstudio/dist/
```

`./deploy.sh` runs those steps.

## Hosting under a different path

Build with the path you will serve it from (the trailing slash matters):

```sh
npx vite build --base=/my/path/ --outDir=dist-custom
```

Then upload the contents of `dist-custom/` to that path. `npm run build:vps` is an example that uses `/pixelartstudio/` and writes `dist-vps/`.

## Server requirements

- Serve over HTTPS. Service workers and installing the PWA need it (`localhost` is exempt).
- Serve `index.html`, `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache`, and `assets/` with long-lived immutable caching.
- Serve `manifest.webmanifest` as `application/manifest+json`.

Example nginx snippet for a site served at `/pixelartstudio/`:

```nginx
location /pixelartstudio/ {
    try_files $uri $uri/ /pixelartstudio/index.html;
}
location = /pixelartstudio/sw.js                 { add_header Cache-Control "no-cache"; }
location = /pixelartstudio/index.html            { add_header Cache-Control "no-cache"; }
location = /pixelartstudio/manifest.webmanifest  { add_header Cache-Control "no-cache"; }
location /pixelartstudio/assets/                 { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

Projects are stored in each visitor's browser (IndexedDB), so nothing is written on the server.

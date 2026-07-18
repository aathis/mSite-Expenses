// Bundles src/app.jsx into a single self-contained dist/index.html
// plus the PWA assets (manifest, service worker, icons) from assets/.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";

await build({
  entryPoints: ["src/app.jsx"],
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".jsx": "jsx" },
  jsx: "automatic",
  outfile: "dist/bundle.js",
});

const js = readFileSync("dist/bundle.js", "utf8");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>M-Site Expense Tracker</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>🏗️</text></svg>">
<link rel="alternate icon" type="image/png" href="icon-192.png?v=2">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png?v=2">
<meta name="theme-color" content="#1D1B16">
<style>body{margin:0}</style>
<script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js");</script>
</body>
</html>`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
for (const f of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png"]) {
  copyFileSync("assets/" + f, "dist/" + f);
}
console.log("Built dist/index.html —", Math.round(html.length / 1024), "KB (+ PWA assets)");

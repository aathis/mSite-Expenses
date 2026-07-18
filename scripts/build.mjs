// Bundles src/app.jsx into a single self-contained dist/index.html
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

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
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>🏗️</text></svg>">
<style>body{margin:0}</style>
<script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log("Built dist/index.html —", Math.round(html.length / 1024), "KB");

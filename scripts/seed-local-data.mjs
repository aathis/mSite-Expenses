// Personal one-time helper: converts data/msite-expenses.csv into a browser
// console script that seeds localStorage with your existing expense records.
// This script is NOT part of the built app and never runs in the browser —
// it only runs locally, on demand, via `node scripts/seed-local-data.mjs`.
// The CSV it reads is gitignored and the output must never be committed
// or deployed; it contains your real expense data.
import { readFileSync, writeFileSync } from "fs";

const STORAGE_KEY = "msite-construction-expenses-v1";
const CSV_PATH = "data/msite-expenses.csv";
const OUT_PATH = process.argv[2] || "seed-console-script.local.js";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(CSV_PATH, "utf8");
const rows = parseCsv(text);
const header = rows[0].map((h) => h.trim());
const idx = (name) => header.indexOf(name);

const expenses = rows.slice(1).map((r, i) => ({
  id: "seed-" + i + "-" + Date.now().toString(36),
  date: (r[idx("date")] || "").trim(),
  paidTo: (r[idx("paid_to")] || "").trim(),
  amount: parseFloat(r[idx("amount")]),
  category: (r[idx("category")] || "").trim() || "Misc & Tips",
  notes: (r[idx("notes")] || "").trim(),
})).filter((e) => e.date && e.paidTo && !isNaN(e.amount));

const script = `// One-time seed: paste this into your browser's DevTools Console while
// the M-Site Expense Tracker tab is open, then press Enter, then reload the page.
// This only writes to THIS browser's local storage — nothing is sent anywhere.
(function () {
  var existing = [];
  try { existing = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})) || []; } catch (e) {}
  var seed = ${JSON.stringify(expenses)};
  localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(existing.concat(seed)));
  console.log("Seeded " + seed.length + " expenses. Reload the page now.");
})();
`;

writeFileSync(OUT_PATH, script);
console.log(`Wrote ${expenses.length} expenses to ${OUT_PATH}`);
console.log("This file contains your real financial data — do not commit or share it.");

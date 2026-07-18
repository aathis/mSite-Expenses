// Personal one-time helper: converts data/msite-expenses.csv into a JSON
// seed file for the app's hidden ?seed import (pick-a-file, no DevTools).
// This script is NOT part of the built app — it only runs locally via
// `node scripts/seed-local-data.mjs [output-path]`. The CSV it reads is
// gitignored and the output must never be committed or deployed; it
// contains real expense data.
import { readFileSync, writeFileSync } from "fs";

const CSV_PATH = "data/msite-expenses.csv";
const OUT_PATH = process.argv[2] || "msite-seed.local.json";

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

writeFileSync(OUT_PATH, JSON.stringify(expenses, null, 1));
console.log(`Wrote ${expenses.length} expenses to ${OUT_PATH}`);
console.log("This file contains your real financial data — do not commit or share it.");

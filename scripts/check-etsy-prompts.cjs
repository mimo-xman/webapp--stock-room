#!/usr/bin/env node
/* Quick consistency check for the new Etsy prompt templates.
 * - CUT HERE line present
 * - every [BRACKETED] token below the cut line is a known variable
 * - both global-rule markers present below the cut line
 * - 4a/4b/4c sections present
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHARED = [
  "[ZAZO IMAGE STUDIO API LINK]",
  "[ZAZO IMAGE STUDIO API KEY]",
  "[STOCK ROOM API LINK]",
  "[STOCK ROOM API KEY]",
  "[ZAZO IMAGE STUDIO REPO LINK]",
  "[STOCK ROOM REPO LINK]",
];
const SPECIFIC = {
  "activity-book-etsy.md": ["[NUMBER OF ACTIVITY PAGES]"],
  "party-invitations-etsy.md": ["[NUMBER OF INVITATION DESIGNS]"],
  "wall-art-set-etsy.md": ["[NUMBER OF ART PRINTS]"],
  "printable-set-etsy.md": ["[NUMBER OF PRINTABLE PAGES]"],
  "clipart-bundle-etsy.md": ["[NUMBER OF CLIPART ELEMENTS]"],
  "digital-download-etsy.md": ["[NUMBER OF PRODUCT IMAGES]"],
};

let failed = 0;
for (const [file, vars] of Object.entries(SPECIFIC)) {
  const md = fs.readFileSync(path.join(ROOT, "prompts", file), "utf8");
  const lines = md.split("\n");
  const cut = lines.findIndex((l) => l.includes("CUT HERE"));
  if (cut === -1) { console.error(`FAIL ${file}: no CUT HERE line`); failed++; continue; }
  const body = lines.slice(cut + 1).join("\n");

  const known = new Set([...SHARED, ...vars]);
  const tokens = new Set([...body.matchAll(/\[([A-Z0-9' ]+)\]/g)].map((m) => `[${m[1]}]`));
  const unknown = [...tokens].filter((t) => !known.has(t));
  const missing = [...known].filter((t) => !tokens.has(t));

  const checks = [
    ["markers", body.includes("NO LIVING BEINGS") && body.includes("CLEARLY DIFFERENTIATED")],
    ["4a", body.includes("### 4a —")],
    ["4b", body.includes("### 4b —")],
    ["4c", body.includes("### 4c —")],
    ["lyra", body.includes("APPENDIX E — LYRA")],
    ["appendixA", body.includes("APPENDIX A — Zazo")],
    ["appendixB", body.includes("APPENDIX B — Stock Room")],
    ["formulas", body.includes("APPENDIX D")],
    ["no-unknown-tokens", unknown.length === 0],
    ["all-vars-used", missing.length === 0],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (unknown.length) console.error(`  ${file}: unknown tokens: ${unknown.join(", ")}`);
  if (missing.length) console.error(`  ${file}: unused declared vars: ${missing.join(", ")}`);
  if (bad.length) { console.error(`FAIL ${file}: ${bad.join(", ")}`); failed++; }
  else console.log(`OK   ${file} (${(body.length / 1000).toFixed(1)}k chars, ${tokens.size} token types)`);
}
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
import { runSync } from "./lib/sync-core.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));

runSync(config)
  .then((r) => {
    console.log(
      `ok — total ${(r.totalBytesGB).toFixed(1)} GB through router` +
        (r.baseline ? " (baseline captured)" : r.reboot ? " (router rebooted)" : ` (+${r.addedTodayGB.toFixed(2)} GB today)`)
    );
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });

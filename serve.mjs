#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync, loadStore, STORE_PATH } from "./lib/sync-core.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(DIR, "dist");
const PORT = 5177;
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const state = {
  syncing: false,
  lastError: null,
  timer: null,
};

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
    return cfg.password ? cfg : null;
  } catch {
    return null;
  }
}

async function sync() {
  const config = loadConfig();
  if (!config) return;
  if (state.syncing) return;
  state.syncing = true;
  state.lastError = null;
  try {
    const result = await runSync(config);
    state.lastResult = result;
    console.log(
      `[sync] ok — total ${result.totalBytesGB.toFixed(1)} GB through router` +
        (result.baseline ? " (baseline captured)" : result.reboot ? " (router rebooted)" : ` (+${result.addedTodayGB.toFixed(2)} GB today)`)
    );
  } catch (err) {
    state.lastError = err.message;
    console.error("[sync] failed:", err.message);
  } finally {
    state.syncing = false;
  }
}

function scheduleSync() {
  clearInterval(state.timer);
  state.timer = setInterval(sync, SYNC_INTERVAL_MS);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/store") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadStore()));
    return;
  }

  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ syncing: state.syncing, error: state.lastError, autoConfigured: !!loadConfig() }));
    return;
  }

  if (url.pathname === "/api/sync" && req.method === "POST") {
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true }));
    sync();
    return;
  }

  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  let full = path.join(DIST, path.normalize(file).replace(/^([.][.][/\\])+/, ""));
  if (!full.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, "index.html"), (err2, indexData) => {
        if (err2) {
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("Frontend not built yet. Run: npm run build");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`DataPulse running at http://localhost:${PORT}`);
  if (!loadConfig()) {
    console.log("Auto-sync not configured yet. Run: node setup.mjs");
  } else {
    console.log(`Auto-sync every ${SYNC_INTERVAL_MS / 60000} min.`);
    sync();
  }
  scheduleSync();
});

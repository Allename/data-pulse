process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STORE_PATH = path.join(DIR, "store.json");
const GB = 1e9;

export function loadStore() {
  try {
    const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      days: {},
      lastTotalBytes: null,
      lastSync: null,
      reboots: 0,
      ...store,
    };
  } catch {
    return { days: {}, lastTotalBytes: null, lastSync: null, reboots: 0 };
  }
}

export function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(extra) {
    const parts = [...this.map.entries()].map(([k, v]) => `${k}=${v}`);
    if (extra) parts.unshift(extra);
    return parts.join("; ");
  }
}

async function req(routerUrl, jar, pathname, opts = {}) {
  const res = await fetch(routerUrl + pathname, {
    redirect: "manual",
    ...opts,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: routerUrl + "/login.asp",
      ...(opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      Cookie: jar.header(opts.extraCookie),
      ...(opts.headers || {}),
    },
  });
  jar.absorb(res);
  return res;
}

let resolvedUrl = null;

async function resolveRouterUrl(configured) {
  if (resolvedUrl) return resolvedUrl;
  const base = configured.replace(/\/$/, "");
  const host = base.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  const candidates = [...new Set([base, `https://${host}:80`, `http://${host}`])];

  for (const candidate of candidates) {
    try {
      const res = await req(candidate, new CookieJar(), "/asp/GetRandCount.asp", { method: "POST", body: "" });
      const text = await res.text();
      if (res.status === 200 && /^[0-9a-f]{16,}$/i.test(text.trim())) {
        resolvedUrl = candidate;
        return resolvedUrl;
      }
    } catch {}
  }
  throw new Error(`Router not reachable (tried: ${candidates.join(", ")}). Is this machine on the router's network?`);
}

export async function login(routerUrlIn, username, password) {
  const routerUrl = await resolveRouterUrl(routerUrlIn);
  const jar = new CookieJar();

  try {
    await req(routerUrl, jar, "/login.asp");
  } catch {}

  const getToken = async () => {
    const r = await req(routerUrl, jar, "/asp/GetRandCount.asp", { method: "POST", body: "" });
    return { status: r.status, token: (await r.text()).trim().replace(/^﻿/, "") };
  };
  let { status: randStatus, token } = await getToken();
  if (!/^[0-9a-f]{16,}$/i.test(token)) {
    // The router occasionally serves its bootstrap/redirect page here (e.g. when
    // another admin session is active or it is briefly busy). Retry once.
    await new Promise((r) => setTimeout(r, 800));
    ({ status: randStatus, token } = await getToken());
  }
  if (!/^[0-9a-f]{16,}$/i.test(token)) {
    throw new Error(`Could not get login token from router (HTTP ${randStatus}) — is another admin session open?`);
  }

  const langCookie = `Cookie=body:Language:en:id=-1`;
  const body = new URLSearchParams({
    UserName: username,
    PassWord: Buffer.from(password, "utf8").toString("base64"),
    Language: "en",
    "x.X_HW_Token": token,
  }).toString();

  const loginRes = await req(routerUrl, jar, "/login.cgi", {
    method: "POST",
    body,
    extraCookie: langCookie,
  });
  const html = await loginRes.text();

  try {
    fs.mkdirSync(path.join(DIR, "debug"), { recursive: true });
    fs.writeFileSync(
      path.join(DIR, "debug", "last-login.txt"),
      `status: ${loginRes.status}\ncookies: ${[...jar.map.entries()].map(([k, v]) => `${k}=${v.slice(0, 12)}…`).join(", ")}\n\n${html}`
    );
  } catch {}

  const hasSession = [...jar.map.keys()].some((k) => /session|sid/i.test(k));
  const redirectedIn = /pageName\s*=\s*'\/'/.test(html) || /index(_\w+)?\.asp|frame/i.test(html);
  const failed = !hasSession && !redirectedIn;
  if (failed || (!hasSession && !redirectedIn)) {
    throw new Error("Login failed — check the router credentials in config.json.");
  }
  return { jar, page: html };
}

const STAT_CANDIDATES = [
  "/html/ssmp/statistic/stat_wan_info.asp",
  "/html/ssmp/statistic/stat_waninfo.asp",
  "/html/bbsp/statistic/stat_wan_info.asp",
  "/html/ssmp/wanstatistic/stat_wan_info.asp",
  "/html/ssmp/statistic/statistic_wan_info.asp",
];

export async function findStatsPage(routerUrl, jar, landingPage) {
  const seen = new Set();

  for (const p of STAT_CANDIDATES) {
    const res = await req(routerUrl, jar, p);
    const text = await res.text();
    seen.add(p);
    if (res.status === 200 && text.includes("<") && /byte/i.test(text)) {
      return { path: p, html: text };
    }
  }

  const links = new Set();
  for (const m of landingPage.matchAll(/(?:href|src)=["']([^"']+\.asp[^"']*)["']/gi)) {
    links.add(m[1].split("?")[0]);
  }

  const queue = [...links].slice(0, 60);
  for (const link of queue) {
    const full = link.startsWith("/") ? link : "/html/" + link.replace(/^\.?\//, "");
    if (seen.has(full)) continue;
    seen.add(full);
    let res;
    let text;
    try {
      res = await req(routerUrl, jar, full);
      text = await res.text();
    } catch {
      continue;
    }
    if (res.status === 200 && /byte/i.test(text) && /(statistic|stat_|rx|tx)/i.test(text + full)) {
      return { path: full, html: text };
    }
    for (const m of text.matchAll(/(?:href|src)=["']([^"']+\.asp[^"']*)["']/gi)) {
      const nested = m[1].split("?")[0];
      const nf = nested.startsWith("/") ? nested : path.posix.join(path.posix.dirname(full), nested);
      if (!seen.has(nf) && queue.length < 120) queue.push(nf);
    }
  }
  return null;
}

export function extractCounters(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "|").replace(/&nbsp;?/gi, " ");
  const results = [];
  const labelRe = /([A-Za-z ()/]*(?:bytes?|octets)[A-Za-z ()/]*)\|+\s*\|*([0-9][0-9,.\s]{3,})/gi;
  let m;
  while ((m = labelRe.exec(text)) !== null) {
    const label = m[1].replace(/\s+/g, " ").trim();
    const value = parseFloat(m[2].replace(/[,\s]/g, ""));
    if (isFinite(value) && value >= 0) results.push({ label, value });
  }
  if (results.length) return dedupe(results);

  const numRe = /(?:^|[|\s])([0-9]{7,}[0-9,.]*)(?:$|[|\s])/g;
  const nums = [];
  while ((m = numRe.exec(text)) !== null) {
    nums.push(parseFloat(m[1].replace(/[,\s]/g, "")));
  }
  return dedupe(
    nums
      .sort((a, b) => b - a)
      .slice(0, 8)
      .map((v) => ({ label: "?", value: v }))
  );
}

function dedupe(list) {
  const out = [];
  for (const r of list) {
    if (!out.some((o) => o.label === r.label && o.value === r.value)) out.push(r);
  }
  return out.slice(0, 12);
}

export function pickRxTx(counters) {
  const find = (re) => counters.find((c) => re.test(c.label));
  const rx = find(/receiv|down|ingress|rx/i);
  const tx = find(/send|transmit|up|egress|tx/i);
  if (rx && tx) return rx.value + tx.value;
  if (counters.length >= 2) {
    const sorted = [...counters].sort((a, b) => b.value - a.value);
    return sorted[0].value + sorted[1].value;
  }
  if (counters.length === 1) return counters[0].value;
  return null;
}

// Newer Huawei ONT firmware (e.g. HG8145X7) no longer publishes a WAN
// statistics HTML table. The real cumulative counters live in the GPON
// GEM-port stats rendered on the Ethernet info page as JS constructor calls:
//   new GEMStats(domain, gemId, tcontId, txPackets, txPackets_H, txBytes,
//                txBytes_H, rxPackets, rxPackets_H, rxBytes, rxBytes_H,
//                discard, direction, type)
// 64-bit counters are split into a low word plus a high word scaled by 2^32.
// We sum tx+rx bytes across every GEM port that carries traffic.
const U32 = 4294967296;

export function parseGemBytes(html) {
  const toInt = (s) => {
    const v = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(v) ? v : 0;
  };
  let total = 0;
  let ports = 0;
  for (const m of html.matchAll(/new\s+GEMStats\s*\(([^)]*)\)/g)) {
    const parts = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    if (parts.length < 11) continue;
    const txBytes = toInt(parts[5]) + toInt(parts[6]) * U32;
    const rxBytes = toInt(parts[9]) + toInt(parts[10]) * U32;
    const sum = txBytes + rxBytes;
    if (sum > 0) {
      total += sum;
      ports++;
    }
  }
  return ports ? total : null;
}

export async function fetchTotalBytes({ routerUrl, username, password }) {
  const url = routerUrl.replace(/\/$/, "");
  const { jar, page } = await login(url, username, password);

  // Preferred path: GPON GEM-port counters (current firmware).
  try {
    const ethRes = await req(url, jar, "/html/amp/ethinfo/ethinfo.asp");
    if (ethRes.status === 200) {
      const gemBytes = parseGemBytes(await ethRes.text());
      if (gemBytes != null) {
        return { totalBytes: gemBytes, statsPath: "/html/amp/ethinfo/ethinfo.asp (GEM)" };
      }
    }
  } catch {
    // fall through to the legacy discovery path
  }

  // Fallback: older firmware exposes a dedicated WAN statistics page.
  const stats = await findStatsPage(url, jar, page);
  if (!stats) {
    throw new Error("Could not locate WAN byte counters on the router (GEM stats and legacy statistics page both unavailable).");
  }
  const counters = extractCounters(stats.html);
  const totalBytes = pickRxTx(counters);
  if (totalBytes == null) {
    throw new Error("Found the stats page but could not parse byte values: " + JSON.stringify(counters));
  }
  return { totalBytes, statsPath: stats.path };
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function runSync({ routerUrl, username, password }) {
  const { totalBytes, statsPath } = await fetchTotalBytes({ routerUrl, username, password });

  const store = loadStore();
  const today = todayISO();
  const result = { totalBytesGB: totalBytes / GB, addedTodayGB: 0, reboot: false, baseline: false };

  if (store.lastTotalBytes != null) {
    let delta = totalBytes - store.lastTotalBytes;
    if (delta < 0) {
      store.reboots++;
      result.reboot = true;
      delta = 0;
    }
    const gb = delta / GB;
    result.addedTodayGB = gb;
    store.days[today] = Math.round(((store.days[today] || 0) + gb) * 10000) / 10000;
  } else {
    result.baseline = true;
  }

  store.lastTotalBytes = totalBytes;
  store.lastSync = new Date().toISOString();
  store.statsPath = statsPath;
  saveStore(store);
  return result;
}

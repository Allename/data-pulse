#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "config.json");

function prompt(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      process.stdout.write(question);
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl._writeToOutput = (str) => {
      if (str.includes(question)) rl.output.write(question);
      else if (/[*]/.test(str)) rl.output.write("*");
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    rl.on("error", reject);
  });
}

async function main() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {}

  const ask = (question, fallback) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim() || fallback);
      });
    });

  const defaultUrl = config.routerUrl || "https://192.168.100.1:80";
  const routerUrl = await ask(`Router address [${defaultUrl}]: `, defaultUrl);
  const username = await ask(`Router username [${config.username || "admin"}]: `, config.username || "admin");
  const password = await prompt("Router admin password: ");
  if (!password) {
    console.error("No password entered. Aborting.");
    process.exit(1);
  }

  config.routerUrl = routerUrl.replace(/\/+$/, "");
  config.username = username;
  config.password = password;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.chmodSync(CONFIG_PATH, 0o600);
  console.log("Saved to config.json (readable only by your user). Auto-sync is now enabled.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Opt-in live smoke. Requires CELMBOT_LIVE=1 and keys already in <freecel>/.celmbot
 * (or CELMBOT_CONFIG_DIR).
 * Does not print secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CELMBOT_LIVE !== "1") {
  console.log("Skipping live smoke. Set CELMBOT_LIVE=1 after adding keys in the CelmBot UI.");
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installRoot = path.resolve(scriptDir, "..");
const configDir = process.env.CELMBOT_CONFIG_DIR
  ? path.resolve(process.env.CELMBOT_CONFIG_DIR)
  : path.join(installRoot, ".celmbot");
const cfgPath = path.join(configDir, "config.json");
if (!fs.existsSync(cfgPath)) {
  console.error("No config at", cfgPath, "— start CelmBot and add keys first (PAUSE B/C).");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const keys = [...(cfg.keys?.cloud || []), ...(cfg.keys?.local || [])].filter((k) => k.enabled);
if (!keys.length) {
  console.error("No enabled keys. Add Cloud/Local keys in the UI, then re-run.");
  process.exit(1);
}

console.log(`Found ${keys.length} enabled key(s) in ${cfgPath}.`);
console.log("See docs/LIVE_SMOKE.md for the step list. This script does not burn quota automatically.");
process.exit(0);

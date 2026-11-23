#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import pc from "picocolors";
import { createServer } from "./server/app.js";
import { DEFAULT_PORT, PORT_FALLBACK_END } from "./shared/types.js";
import {
  ensureDataDir,
  getDataDir,
  getInstallRoot,
  setProjectRoot,
} from "./paths.js";

function parsePort(): number {
  const fromEnv = process.env.CELMBOT_PORT ? Number(process.env.CELMBOT_PORT) : undefined;
  const argIdx = process.argv.indexOf("--port");
  const fromArg = argIdx >= 0 ? Number(process.argv[argIdx + 1]) : undefined;
  return fromArg || fromEnv || DEFAULT_PORT;
}

function parseWorkspaceHint(): string | undefined {
  const argIdx = process.argv.indexOf("--project");
  if (argIdx >= 0 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]!);
  }
  if (process.env.CELMBOT_PROJECT) {
    return path.resolve(process.env.CELMBOT_PROJECT);
  }
  return undefined;
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function main(): Promise<void> {
  ensureDataDir();
  const hint = parseWorkspaceHint();
  if (hint) {
    try {
      setProjectRoot(hint);
    } catch {
      console.warn(pc.yellow(`Ignoring --project (not a directory): ${hint}`));
    }
  }
  const { markInterruptedRuns } = await import("./agent/persistence.js");
  const interrupted = markInterruptedRuns();
  if (interrupted) {
    console.log(pc.dim(`Marked ${interrupted} in-flight run(s) as interrupted`));
  }
  const preferred = parsePort();
  const start = preferred === DEFAULT_PORT ? DEFAULT_PORT : preferred;
  const end = preferred === DEFAULT_PORT ? PORT_FALLBACK_END : preferred;
  const openBrowser = process.env.BROWSER !== "none" && !process.argv.includes("--no-open");

  let bound: number | null = null;
  let server: http.Server | null = null;

  for (let p = start; p <= end; p++) {
    const created = createServer();
    server = created.server;
    try {
      bound = await listen(server, p);
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      server.close();
      server = null;
      if (e.code !== "EADDRINUSE") throw err;
    }
  }

  if (bound == null || !server) {
    console.error(pc.red(`Could not bind 127.0.0.1:${start}-${end}. Free a port or pass --port.`));
    process.exit(1);
  }

  const url = `http://127.0.0.1:${bound}`;
  console.log(pc.cyan("CelmBot") + ` listening on ${pc.bold(url)}`);
  console.log(pc.dim(`Install ${getInstallRoot()}`));
  console.log(pc.dim(`Data ${getDataDir()}`));
  console.log(pc.dim("Localhost only · no telemetry · verification-first · free-tier swarm"));
  if (openBrowser) {
    try {
      const open = (await import("open")).default;
      await open(url);
    } catch {
      console.log(pc.yellow("Open the URL above in your browser."));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

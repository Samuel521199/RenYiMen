import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), false);

const standaloneServer = join(process.cwd(), ".next", "standalone", "server.js");
if (!existsSync(standaloneServer)) {
  throw new Error("Missing .next/standalone/server.js. Run `npm run build` before starting production.");
}
const staticSource = join(process.cwd(), ".next", "static");
const staticTarget = join(process.cwd(), ".next", "standalone", ".next", "static");
if (existsSync(staticSource)) {
  mkdirSync(dirname(staticTarget), { recursive: true });
  cpSync(staticSource, staticTarget, { recursive: true, force: true });
}

const children = new Set();
let stopping = false;

function start(label, args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    stopping = true;
    console.error(`[production] ${label} exited`, { code, signal });
    for (const other of children) other.kill("SIGTERM");
    process.exitCode = code ?? 1;
  });
  child.once("error", (error) => {
    console.error(`[production] failed to start ${label}`, error);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

start("web", [standaloneServer], {
  ...process.env,
  NODE_ENV: "production",
  PORT: "3001",
  HOSTNAME: "0.0.0.0",
});
if (process.env.ONE_PROMPT_METRICS_DISABLED !== "1") {
  start(
    "production metrics dashboard",
    ["--import", "tsx", "scripts/one-prompt-production-dashboard.ts"],
    {
      ...process.env,
      NODE_ENV: "production",
      ONE_PROMPT_METRICS_PORT: process.env.ONE_PROMPT_METRICS_PORT || "3011",
    },
  );
}
for (const worker of [
  { label: "planning worker", id: "production-planning", kinds: "planning" },
  { label: "image worker", id: "production-image", kinds: "image_prepare_submit,micro_shot_prepare_submit" },
  { label: "clip and compose worker", id: "production-clip-compose", kinds: "clip_prepare_submit,compose" },
  { label: "quality worker", id: "production-quality", kinds: "image_quality" },
]) {
  start(
    worker.label,
    ["--import", "tsx", "scripts/video-production-worker.ts"],
    {
      ...process.env,
      NODE_ENV: "production",
      VIDEO_PRODUCTION_WORKER_ID: worker.id,
      VIDEO_PRODUCTION_WORKER_KINDS: worker.kinds,
    },
  );
}

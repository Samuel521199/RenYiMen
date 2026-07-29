import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), true);
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
    console.error(`[dev] ${label} exited`, { code, signal });
    for (const other of children) other.kill("SIGTERM");
    process.exitCode = code ?? 1;
  });
  child.once("error", (error) => {
    console.error(`[dev] failed to start ${label}`, error);
  });
  return child;
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

start("web", [nextCli, "dev", "--turbopack", "--port", "3001"]);
for (const worker of [
  { label: "planning worker", id: "local-planning", kinds: "planning" },
  { label: "image worker", id: "local-image", kinds: "image_prepare_submit,micro_shot_prepare_submit" },
  { label: "clip and compose worker", id: "local-clip-compose", kinds: "clip_prepare_submit,compose" },
  { label: "quality worker", id: "local-quality", kinds: "image_quality" },
]) {
  start(
    worker.label,
    ["--watch", "--watch-preserve-output", "--import", "tsx", "scripts/video-production-worker.ts"],
    {
      ...process.env,
      VIDEO_PRODUCTION_WORKER_ID: worker.id,
      VIDEO_PRODUCTION_WORKER_KINDS: worker.kinds,
    },
  );
}

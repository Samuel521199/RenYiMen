import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), true);
const children = new Set();
let stopping = false;
const devRuntimeVersion =
  process.env.VIDEO_PRODUCTION_RUNTIME_VERSION?.trim()
  || `dev-session-${Date.now().toString(36)}`;
const devEnvironment = {
  ...process.env,
  VIDEO_PRODUCTION_RUNTIME_VERSION: devRuntimeVersion,
};
const windowsTsxShimUrl = pathToFileURL(require.resolve("./windows-node24-tsx-shim.mjs")).href;

function start(label, args, env = process.env, command = process.execPath, cwd = process.cwd()) {
  const child = spawn(command, args, {
    cwd,
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

function workbenchBackendTarget() {
  const raw = process.env.WORKBENCH_BACKEND_URL?.trim() || "http://localhost:8000";
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (!isLoopback) return null;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0) return null;
    return {
      host: hostname === "localhost" ? "127.0.0.1" : hostname,
      port,
      raw,
    };
  } catch {
    return null;
  }
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function isWorkbenchBackendResponsive(rawUrl) {
  try {
    const url = new URL("/docs", rawUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function maybeStartWorkbenchBackend() {
  if (process.env.WORKBENCH_BACKEND_AUTOSTART === "false") return;

  const target = workbenchBackendTarget();
  if (!target) return;

  if (await isPortOpen(target.host, target.port)) {
    if (await isWorkbenchBackendResponsive(target.raw)) {
      console.error(`[dev] workbench backend already running at ${target.raw}`);
    } else {
      console.error(
        `[dev] port ${target.port} is open, but Workbench backend did not respond to HTTP. ` +
        "If Workbench SSO fails, restart the workbench-backend container or free the port.",
      );
    }
    return;
  }

  const backendCwd = path.join(process.cwd(), "ai-workflow-code", "backend");
  const pythonCandidates = [
    path.join(process.cwd(), ".venv-workbench", "Scripts", "python.exe"),
    path.join(process.cwd(), "ai-workflow-code", ".venv", "Scripts", "python.exe"),
  ];
  const python = pythonCandidates.find((candidate) => existsSync(candidate));

  if (!existsSync(path.join(backendCwd, "app", "main.py")) || !python) {
    console.error(
      `[dev] workbench backend is not running at ${target.raw}; ` +
      "Workbench SSO will fail until the FastAPI backend is started.",
    );
    return;
  }

  start(
    "workbench backend",
    ["-m", "uvicorn", "app.main:app", "--host", target.host, "--port", String(target.port)],
    {
      ...devEnvironment,
      PYTHONUNBUFFERED: "1",
    },
    python,
    backendCwd,
  );
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

await maybeStartWorkbenchBackend();

start("web", [nextCli, "dev", "--turbopack", "--port", "3001"], devEnvironment);
for (const worker of [
  { label: "planning worker", id: "local-planning", kinds: "planning" },
  { label: "image worker", id: "local-image", kinds: "image_prepare_submit,micro_shot_prepare_submit" },
  { label: "clip and compose worker", id: "local-clip-compose", kinds: "clip_prepare_submit,compose" },
  { label: "quality worker", id: "local-quality", kinds: "image_quality" },
]) {
  const tsxArgs = process.platform === "win32"
    ? ["--import", windowsTsxShimUrl, "--import", "tsx"]
    : ["--import", "tsx"];
  start(
    worker.label,
    [...tsxArgs, "scripts/video-production-worker.ts"],
    {
      ...devEnvironment,
      VIDEO_PRODUCTION_WORKER_ID: worker.id,
      VIDEO_PRODUCTION_WORKER_KINDS: worker.kinds,
    },
  );
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const generatedClientPath = path.join(
  projectRoot,
  "node_modules",
  ".prisma",
  "client",
  "index.js",
);
const schemaPath = path.join(projectRoot, "prisma", "schema.prisma");
const prismaCliPath = require.resolve("prisma/build/index.js");

if (isGeneratedClientReady()) {
  console.log("[dev] Prisma Client is ready; generation skipped.");
  process.exit(0);
}

console.log("[dev] Prisma Client is missing, stale, or has no local engine; regenerating...");

const maxAttempts = 6;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = spawnSync(process.execPath, [prismaCliPath, "generate"], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
  });
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();

  if (result.status === 0 && isGeneratedClientReady()) {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    process.exit(0);
  }

  const output = [stdout, stderr, result.error?.message].filter(Boolean).join("\n");
  const isWindowsEngineLock =
    process.platform === "win32"
    && /EPERM: operation not permitted, rename/i.test(output)
    && /query_engine-windows\.dll\.node/i.test(output);

  if (!isWindowsEngineLock || attempt === maxAttempts) {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (result.error) console.error(result.error);
    process.exit(result.status ?? 1);
  }

  console.warn(
    `[dev] Prisma engine is still being released; retrying generation (${attempt}/${maxAttempts})...`,
  );
  await delay(attempt * 500);
}

function isGeneratedClientReady() {
  if (!existsSync(generatedClientPath) || !existsSync(schemaPath)) return false;

  try {
    const generatedClient = readFileSync(generatedClientPath, "utf8");
    const hasLocalEngine = /"copyEngine"\s*:\s*true/.test(generatedClient);
    const schemaIsCurrent =
      statSync(generatedClientPath).mtimeMs >= statSync(schemaPath).mtimeMs;
    return hasLocalEngine && schemaIsCurrent;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

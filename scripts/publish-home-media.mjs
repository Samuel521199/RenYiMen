import { createReadStream, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));

const mediaConfig = JSON.parse(readFileSync(resolve(root, "config/home-media.json"), "utf8"));
const sourceFiles = [
  "src/app/(platform)/workbench/home/page.tsx",
  "src/components/home/HomeShowcaseCarousel.tsx",
  "src/components/home/PopularWorksShowcase.tsx",
];
const mediaPaths = [...new Set(sourceFiles.flatMap((sourceFile) => {
  const source = readFileSync(resolve(root, sourceFile), "utf8");
  return [...source.matchAll(/\/(?:covers|model-showcase|showcase\/popular-works)\/[^"?]+\.mp4/g)]
    .map((match) => match[0]);
}))].sort();

const required = ["OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_SECRET_ACCESS_KEY", "OSS_BUCKET_NAME"];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}
const publicDomain = (process.env.OSS_MEDIA_PUBLIC_DOMAIN || process.env.OSS_PUBLIC_DOMAIN || "").trim().replace(/\/+$/, "");
if (!publicDomain) throw new Error("OSS_MEDIA_PUBLIC_DOMAIN or OSS_PUBLIC_DOMAIN is required");

const client = new S3Client({
  region: process.env.OSS_REGION.trim(),
  ...(process.env.OSS_ENDPOINT?.trim() ? { endpoint: process.env.OSS_ENDPOINT.trim() } : {}),
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.OSS_SECRET_ACCESS_KEY.trim(),
  },
  forcePathStyle: process.env.OSS_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

function atomOffsets(file) {
  const body = readFileSync(file);
  return {
    moov: body.indexOf(Buffer.from("moov")),
    mdat: body.indexOf(Buffer.from("mdat")),
  };
}

function ensureFastStart(file) {
  const before = atomOffsets(file);
  if (before.moov >= 0 && before.mdat >= 0 && before.moov < before.mdat) return false;
  const temporary = `${file}.faststart.tmp.mp4`;
  const backup = `${file}.faststart.backup.mp4`;
  rmSync(temporary, { force: true });
  rmSync(backup, { force: true });
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", file,
    "-map", "0", "-c", "copy", "-movflags", "+faststart", temporary,
  ], { stdio: "inherit" });
  if (result.status !== 0) {
    rmSync(temporary, { force: true });
    throw new Error(`ffmpeg failed for ${file}`);
  }
  const after = atomOffsets(temporary);
  if (after.moov < 0 || after.mdat < 0 || after.moov > after.mdat) {
    rmSync(temporary, { force: true });
    throw new Error(`Fast Start verification failed for ${file}`);
  }
  renameSync(file, backup);
  try {
    renameSync(temporary, file);
    rmSync(backup, { force: true });
  } catch (error) {
    if (existsSync(backup) && !existsSync(file)) renameSync(backup, file);
    throw error;
  }
  return true;
}

async function upload(pathname) {
  const localFile = resolve(root, `public${pathname.replaceAll("/", "\\")}`);
  if (!existsSync(localFile)) throw new Error(`Missing homepage media: ${localFile}`);
  const optimized = ensureFastStart(localFile);
  const key = `${mediaConfig.version}/${pathname.replace(/^\/+/, "")}`;
  const size = statSync(localFile).size;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: process.env.OSS_BUCKET_NAME.trim(),
        Key: key,
        Body: createReadStream(localFile),
        ContentLength: size,
        ContentType: "video/mp4",
        ContentDisposition: "inline",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      const url = `${publicDomain}/${key.split("/").map(encodeURIComponent).join("/")}`;
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw new Error(`verification HTTP ${response.status}`);
      const cacheControl = response.headers.get("cache-control") ?? "";
      if (!cacheControl.includes("immutable")) throw new Error(`unexpected Cache-Control: ${cacheControl}`);
      process.stdout.write(`${optimized ? "optimized" : "ready"} ${pathname} -> ${url}\n`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

for (const pathname of mediaPaths) await upload(pathname);
process.stdout.write(`Published ${mediaPaths.length} homepage videos at ${publicDomain}/${mediaConfig.version}/\n`);

import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_GLB_BYTES = 350 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CONVERSION_TIMEOUT_MS = 10 * 60_000;
const MAX_PROCESS_LOG_CHARS = 64_000;
const BLENDER_SCRIPT_PATH = join(process.cwd(), "scripts", "model-export-blender.py");

type ExportKind = "fbx" | "textures";

class ExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function isPrivateIp(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? value;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicHttpUrl(value: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ExportError("模型地址无效，请重新生成后再试。", 400, "INVALID_MODEL_URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ExportError("仅支持 HTTP 或 HTTPS 模型地址。", 400, "UNSUPPORTED_MODEL_URL");
  }
  if (parsed.username || parsed.password) {
    throw new ExportError("模型地址不能包含登录凭据。", 400, "UNSAFE_MODEL_URL");
  }
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new ExportError("模型地址不能指向本机或内网。", 400, "BLOCKED_MODEL_HOST");
  }
  return parsed;
}

async function fetchGlbToFile(sourceUrl: string, destination: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let current = await assertPublicHttpUrl(sourceUrl);
    let response: Response | undefined;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "model/gltf-binary,application/octet-stream;q=0.9,*/*;q=0.5" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirect === 3) {
        throw new ExportError("模型下载重定向次数过多。", 502, "MODEL_REDIRECT_FAILED");
      }
      current = await assertPublicHttpUrl(new URL(location, current).toString());
    }
    if (!response?.ok || !response.body) {
      throw new ExportError(`无法下载模型文件（HTTP ${response?.status ?? 502}）。`, 502, "MODEL_DOWNLOAD_FAILED");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_GLB_BYTES) {
      throw new ExportError("GLB 文件超过 350MB，无法在线转换。", 413, "MODEL_TOO_LARGE");
    }

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength;
        if (received > MAX_GLB_BYTES) {
          callback(new ExportError("GLB 文件超过 350MB，无法在线转换。", 413, "MODEL_TOO_LARGE"));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(destination, { flags: "wx" }));
  } finally {
    clearTimeout(timer);
  }
}

async function windowsBlenderCandidates(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const root = join(process.env.ProgramFiles ?? "C:\\Program Files", "Blender Foundation");
  try {
    const directories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return directories.map((directory) => join(root, directory, "blender.exe"));
  } catch {
    return [];
  }
}

async function blenderCandidates(): Promise<string[]> {
  return [
    process.env.BLENDER_EXECUTABLE?.trim(),
    ...(await windowsBlenderCandidates()),
    process.platform === "win32" ? "blender.exe" : "blender-headless",
    "blender",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

async function runBlenderExport(inputPath: string, outputPath: string, exportKind: ExportKind): Promise<void> {
  await access(BLENDER_SCRIPT_PATH).catch(() => {
    throw new ExportError("服务器缺少模型导出脚本，请联系管理员。", 503, "EXPORT_SCRIPT_MISSING");
  });

  for (const executable of await blenderCandidates()) {
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(
          executable,
          [
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            BLENDER_SCRIPT_PATH,
            "--",
            inputPath,
            outputPath,
            exportKind,
          ],
          { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
        );
        let logs = "";
        const appendLog = (chunk: Buffer) => {
          logs = (logs + chunk.toString("utf8")).slice(-MAX_PROCESS_LOG_CHARS);
        };
        child.stdout.on("data", appendLog);
        child.stderr.on("data", appendLog);
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          rejectPromise(new ExportError("模型转换超时，请稍后重试。", 504, "EXPORT_TIMEOUT"));
        }, CONVERSION_TIMEOUT_MS);
        child.once("error", (error: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          if (error.code === "ENOENT") {
            rejectPromise(error);
            return;
          }
          rejectPromise(new ExportError(`无法启动模型转换器：${error.message}`, 503, "BLENDER_START_FAILED"));
        });
        child.once("close", async (code) => {
          clearTimeout(timer);
          if (code === 0) {
            try {
              const output = await stat(outputPath);
              if (!output.isFile() || output.size === 0) throw new Error("empty export output");
              resolvePromise();
            } catch {
              rejectPromise(new ExportError(
                `模型转换器没有生成 ZIP 文件。${logs.trim() ? `\n${logs.trim().slice(-2000)}` : "请检查服务器 Blender 运行环境。"}`,
                500,
                "BLENDER_OUTPUT_MISSING",
              ));
            }
            return;
          }
          rejectPromise(new ExportError(`模型转换失败。${logs.trim() ? `\n${logs.trim().slice(-2000)}` : ""}`, 500, "BLENDER_EXPORT_FAILED"));
        });
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  throw new ExportError(
    "服务器尚未安装 Blender。请安装 Blender 4.x/5.x，或配置 BLENDER_EXECUTABLE。",
    503,
    "BLENDER_NOT_AVAILABLE",
  );
}

async function safeRemoveTemporaryDirectory(directory: string): Promise<void> {
  const root = resolve(tmpdir());
  const target = resolve(directory);
  if (target === root || !target.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}workflow-model-export-`)) return;
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const sourceUrl = typeof record.url === "string" ? record.url.trim() : "";
  const exportKind = record.format === "fbx" || record.format === "textures" ? record.format : null;
  if (!sourceUrl || !exportKind) {
    return NextResponse.json({ error: "缺少模型地址或导出格式" }, { status: 400 });
  }

  const directory = await mkdtemp(join(tmpdir(), "workflow-model-export-"));
  let streamHandedOff = false;
  try {
    const inputPath = join(directory, "source.glb");
    const outputPath = join(directory, exportKind === "fbx" ? "model-fbx-package.zip" : "model-textures.zip");
    await fetchGlbToFile(sourceUrl, inputPath);
    await runBlenderExport(inputPath, outputPath, exportKind);

    const fileStream = createReadStream(outputPath);
    fileStream.once("close", () => void safeRemoveTemporaryDirectory(directory));
    streamHandedOff = true;
    const filename = basename(outputPath);
    return new NextResponse(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const known = error instanceof ExportError ? error : new ExportError(error instanceof Error ? error.message : "模型导出失败", 500, "MODEL_EXPORT_FAILED");
    console.error("[model-assets/export]", known.code, known.message);
    return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
  } finally {
    if (!streamHandedOff) await safeRemoveTemporaryDirectory(directory);
  }
}

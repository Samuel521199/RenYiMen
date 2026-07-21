import { appendFile, mkdir } from "fs/promises";
import path from "path";

const DEFAULT_LOG_DIR = process.platform === "win32" ? "D:\\zzz\\v debug" : "/tmp/one-prompt-video-debug";
const LOG_FILE_NAME = "one-prompt-video.log";

type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?key|secret|authorization|token|password|signature)/i;

function logDir(): string {
  return process.env.ONE_PROMPT_VIDEO_LOG_DIR?.trim() || DEFAULT_LOG_DIR;
}

export function onePromptVideoLogDir(): string {
  return logDir();
}

export function onePromptVideoLogPath(): string {
  return path.join(logDir(), LOG_FILE_NAME);
}

export async function logOnePromptVideo(
  event: string,
  data: Record<string, unknown> = {},
  level: LogLevel = "info",
): Promise<void> {
  try {
    await mkdir(logDir(), { recursive: true });
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      data: sanitizeForLog(data),
    };
    await appendFile(onePromptVideoLogPath(), `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("[one-prompt-video-log] write failed", error);
  }
}

export function errorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 8).join("\n"),
    };
  }
  return { message: String(error) };
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") return redactSecretLikeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForLog(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeForLog(item, depth + 1);
  }
  return out;
}

function redactSecretLikeString(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(/LTAI[A-Za-z0-9]{10,}/g, "LTAI[REDACTED]")
    .replace(/(AccessKeyId=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Signature=)[^&\s]+/gi, "$1[REDACTED]");
}

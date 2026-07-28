export type PromptDisplayLanguage = "zh" | "en";

const CJK_PATTERN = /[\u3400-\u9fff]/;
const LATIN_LETTER_PATTERN = /[A-Za-z]/g;
const UPPERCASE_LETTER_PATTERN = /[A-Z]/g;

/**
 * Selects and sanitizes presentation copy only. The returned value must never
 * be reused as the provider execution prompt.
 */
export function promptForInterfaceLanguage(params: {
  preferred?: string;
  fallback?: string;
  lang: PromptDisplayLanguage;
}): string {
  const candidates = [params.preferred, params.fallback]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const sanitized = sanitizePromptForInterfaceLanguage(candidate, params.lang);
    if (sanitized) return sanitized;
  }
  return params.lang === "zh"
    ? "中文展示稿暂不可用，请重新生成或直接编辑此提示词。"
    : "The English display copy is unavailable. Regenerate or edit this prompt.";
}

export function sanitizePromptForInterfaceLanguage(
  value: string,
  lang: PromptDisplayLanguage,
): string {
  const chunks = value
    .replace(/\r\n/g, "\n")
    .split(/(\n+|[。；！？;.!?]+\s*|[,，]\s*)/)
    .filter(Boolean);
  const kept: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (isSeparator(chunk)) {
      if (kept.length && index + 1 < chunks.length && isLanguageCompatibleChunk(chunks[index + 1], lang)) {
        kept.push(normalizeSeparator(chunk, lang));
      }
      continue;
    }
    if (isLanguageCompatibleChunk(chunk, lang)) kept.push(chunk.trim());
  }
  return kept
    .join("")
    .replace(/[，,；;\s]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLanguageCompatibleChunk(value: string, lang: PromptDisplayLanguage): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const hasCjk = CJK_PATTERN.test(trimmed);
  if (lang === "en") return !hasCjk;
  if (hasCjk) return true;
  return isProtectedLatinIdentifier(trimmed);
}

function isProtectedLatinIdentifier(value: string): boolean {
  const letters = value.match(LATIN_LETTER_PATTERN) ?? [];
  if (!letters.length) return true;
  const uppercase = value.match(UPPERCASE_LETTER_PATTERN) ?? [];
  const uppercaseRatio = uppercase.length / letters.length;
  return uppercaseRatio >= 0.65
    || /^(?:[A-Z0-9][A-Z0-9_.:/+-]*)(?:\s+[A-Z0-9][A-Z0-9_.:/+-]*)*$/.test(value.trim());
}

function isSeparator(value: string): boolean {
  return /^(\n+|[。；！？;.!?]+\s*|[,，]\s*)$/.test(value);
}

function normalizeSeparator(value: string, lang: PromptDisplayLanguage): string {
  if (value.includes("\n")) return "\n";
  if (lang === "zh") {
    if (/[,，]/.test(value)) return "，";
    if (/[;；]/.test(value)) return "；";
    if (/[!?！？]/.test(value)) return value.includes("?") || value.includes("？") ? "？" : "！";
    return "。";
  }
  if (/[,，]/.test(value)) return ", ";
  if (/[;；]/.test(value)) return "; ";
  if (/[!?！？]/.test(value)) return value.includes("?") || value.includes("？") ? "? " : "! ";
  return ". ";
}

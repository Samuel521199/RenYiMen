import { createHash } from "node:crypto";

const ERROR_CONTEXT_RADIUS = 180;

export type StructuredContentDiagnostic = {
  contentLength: number;
  contentUtf8Bytes: number;
  contentSha256: string;
  redactedFullContent: string;
};

export type JsonParseErrorDiagnostic = {
  name: string;
  message: string;
  position?: number;
  line?: number;
  column?: number;
  contextStart?: number;
  contextEnd?: number;
  contextPointerOffset?: number;
  redactedContextBeforeError?: string;
  redactedContextAfterError?: string;
  redactedContext?: string;
};

export type StructuredContentDiff = {
  identical: boolean;
  beforeLength: number;
  afterLength: number;
  commonPrefixLength: number;
  commonSuffixLength: number;
  beforeChangedStart: number;
  beforeChangedEnd: number;
  afterChangedStart: number;
  afterChangedEnd: number;
  beforeChangedRedacted: string;
  afterChangedRedacted: string;
};

export function structuredContentDiagnostic(
  content: string,
): StructuredContentDiagnostic {
  return {
    contentLength: content.length,
    contentUtf8Bytes: Buffer.byteLength(content, "utf8"),
    contentSha256: createHash("sha256").update(content).digest("hex"),
    redactedFullContent: redactStructuredOutput(content),
  };
}

export function jsonParseErrorDiagnostic(
  error: unknown,
  content: string,
): JsonParseErrorDiagnostic {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const messagePosition = message.match(/\bposition\s+(\d+)\b/i);
  const messageLineColumn = message.match(/\bline\s+(\d+)\s+column\s+(\d+)\b/i);
  let position = messagePosition ? Number(messagePosition[1]) : undefined;
  let line = messageLineColumn ? Number(messageLineColumn[1]) : undefined;
  let column = messageLineColumn ? Number(messageLineColumn[2]) : undefined;

  if (position === undefined && line !== undefined && column !== undefined) {
    position = positionFromLineAndColumn(content, line, column);
  }
  if (position === undefined && /unexpected end|end of json/i.test(message)) {
    position = content.length;
  }
  if (position !== undefined) {
    position = Math.max(0, Math.min(content.length, position));
    const calculated = lineAndColumnAt(content, position);
    line ??= calculated.line;
    column ??= calculated.column;
    const contextStart = Math.max(0, position - ERROR_CONTEXT_RADIUS);
    const contextEnd = Math.min(content.length, position + ERROR_CONTEXT_RADIUS);
    return {
      name,
      message,
      position,
      line,
      column,
      contextStart,
      contextEnd,
      contextPointerOffset: position - contextStart,
      redactedContextBeforeError: redactStructuredOutput(
        content.slice(contextStart, position),
      ),
      redactedContextAfterError: redactStructuredOutput(
        content.slice(position, contextEnd),
      ),
      redactedContext: redactStructuredOutput(
        content.slice(contextStart, contextEnd),
      ),
    };
  }
  return { name, message, line, column };
}

export function structuredContentDiff(
  before: string,
  after: string,
): StructuredContentDiff {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuffix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  return {
    identical: before === after,
    beforeLength: before.length,
    afterLength: after.length,
    commonPrefixLength: prefix,
    commonSuffixLength: suffix,
    beforeChangedStart: prefix,
    beforeChangedEnd: beforeEnd,
    afterChangedStart: prefix,
    afterChangedEnd: afterEnd,
    beforeChangedRedacted: redactStructuredOutput(before.slice(prefix, beforeEnd)),
    afterChangedRedacted: redactStructuredOutput(after.slice(prefix, afterEnd)),
  };
}

export function redactStructuredOutput(content: string): string {
  return content
    .replace(
      /("(?:api[_-]?key|access[_-]?key|secret|authorization|token|password|signature)"\s*:\s*")((?:\\.|[^"\\])*)(")/gi,
      "$1[REDACTED]$3",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(/LTAI[A-Za-z0-9]{10,}/g, "LTAI[REDACTED]")
    .replace(
      /([?&](?:access[_-]?key|api[_-]?key|signature|token|password)=)[^&\s"']+/gi,
      "$1[REDACTED]",
    );
}

function lineAndColumnAt(
  content: string,
  position: number,
): { line: number; column: number } {
  const before = content.slice(0, position);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function positionFromLineAndColumn(
  content: string,
  line: number,
  column: number,
): number | undefined {
  if (line < 1 || column < 1) return undefined;
  const lines = content.split("\n");
  if (line > lines.length) return undefined;
  let position = 0;
  for (let index = 0; index < line - 1; index += 1) {
    position += lines[index].length + 1;
  }
  return Math.min(content.length, position + column - 1);
}

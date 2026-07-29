import { createHash } from "node:crypto";
import { jsonrepair } from "jsonrepair";

export type DeterministicJsonRepairSuccess = {
  status: "repaired";
  value: unknown;
  candidateText: string;
  repairedText: string;
  originalSemanticFingerprint: string;
  repairedSemanticFingerprint: string;
};

export type DeterministicJsonRepairFailure = {
  status: "failed";
  reason:
    | "no_json_candidate"
    | "repair_failed"
    | "parse_failed"
    | "semantic_mismatch";
  error: Error;
  candidateText?: string;
  repairedText?: string;
};

export type DeterministicJsonRepairResult =
  | DeterministicJsonRepairSuccess
  | DeterministicJsonRepairFailure;

export type JsonRepairSemanticValidation =
  | {
      valid: true;
      originalSemanticFingerprint: string;
      repairedSemanticFingerprint: string;
    }
  | { valid: false; message: string };

type SemanticToken = {
  type: "string" | "number" | "literal";
  value: string;
};

export function repairJsonDeterministically(
  input: string,
): DeterministicJsonRepairResult {
  const selection = selectPrimaryJsonCandidate(input);
  if (!selection) {
    return {
      status: "failed",
      reason: "no_json_candidate",
      error: new Error("No JSON object or array candidate was found."),
    };
  }

  const sanitizedCandidate = escapeIllegalJsonControlCharacters(selection.candidateText);
  let repairedText: string;
  try {
    repairedText = jsonrepair(sanitizedCandidate);
  } catch (error) {
    return {
      status: "failed",
      reason: "repair_failed",
      error: asError(error),
      candidateText: sanitizedCandidate,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(repairedText);
  } catch (error) {
    return {
      status: "failed",
      reason: "parse_failed",
      error: asError(error),
      candidateText: sanitizedCandidate,
      repairedText,
    };
  }

  const originalTokens = semanticTokens(sanitizedCandidate);
  const repairedTokens = semanticTokens(repairedText);
  const trailingTokens = semanticTokens(
    escapeIllegalJsonControlCharacters(selection.trailingText),
  );
  const unexpectedTrailingTokens = uniqueTokens(trailingTokens)
    .filter((token) => !uniqueTokens(originalTokens).some(
      (originalToken) => tokenKey(originalToken) === tokenKey(token),
    ));
  if (unexpectedTrailingTokens.length) {
    return {
      status: "failed",
      reason: "semantic_mismatch",
      error: new Error(
        `Discarding the trailing response would remove unique semantic scalars: ${JSON.stringify(unexpectedTrailingTokens.slice(0, 8).map(tokenKey))}.`,
      ),
      candidateText: sanitizedCandidate,
      repairedText,
    };
  }
  const semanticCheck = verifySemanticTokenPreservation(
    originalTokens,
    repairedTokens,
  );
  if (!semanticCheck.valid) {
    return {
      status: "failed",
      reason: "semantic_mismatch",
      error: new Error(semanticCheck.message),
      candidateText: sanitizedCandidate,
      repairedText,
    };
  }

  return {
    status: "repaired",
    value,
    candidateText: sanitizedCandidate,
    repairedText,
    originalSemanticFingerprint: semanticFingerprint(originalTokens),
    repairedSemanticFingerprint: semanticFingerprint(repairedTokens),
  };
}

/**
 * Select one top-level JSON value without changing text inside strings. This
 * removes prose, Markdown fences, and a repeated second top-level response.
 * If the first value is truncated, the remaining text is kept for jsonrepair
 * to close conservatively.
 */
export function extractPrimaryJsonCandidate(input: string): string | undefined {
  return selectPrimaryJsonCandidate(input)?.candidateText;
}

function selectPrimaryJsonCandidate(
  input: string,
): { candidateText: string; trailingText: string } | undefined {
  const withoutBom = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const withoutFenceLines = stripMarkdownFenceLines(withoutBom);
  let start = -1;
  for (let index = 0; index < withoutFenceLines.length; index += 1) {
    const char = withoutFenceLines[index];
    if (char === "{" || char === "[") {
      start = index;
      break;
    }
  }
  if (start < 0) return undefined;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < withoutFenceLines.length; index += 1) {
    const char = withoutFenceLines[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) continue;
      stack.pop();
      if (stack.length === 0) {
        return {
          candidateText: withoutFenceLines.slice(start, index + 1).trim(),
          trailingText: withoutFenceLines.slice(index + 1),
        };
      }
    }
  }
  return {
    candidateText: withoutFenceLines.slice(start).trim(),
    trailingText: "",
  };
}

export function escapeIllegalJsonControlCharacters(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        output += char;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      output += char;
      continue;
    }
    if (char === "\"") {
      output += char;
      inString = true;
      continue;
    }
    if (code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r") {
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

export function validateJsonRepairSemanticPreservation(
  originalInput: string,
  repairedText: string,
): JsonRepairSemanticValidation {
  const originalCandidate = selectPrimaryJsonCandidate(originalInput);
  if (!originalCandidate) {
    return { valid: false, message: "No original JSON object or array candidate was found." };
  }
  const repairedCandidate = selectPrimaryJsonCandidate(repairedText);
  if (!repairedCandidate) {
    return { valid: false, message: "No repaired JSON object or array candidate was found." };
  }
  const originalTokens = semanticTokens(
    escapeIllegalJsonControlCharacters(originalCandidate.candidateText),
  );
  const repairedTokens = semanticTokens(
    escapeIllegalJsonControlCharacters(repairedCandidate.candidateText),
  );
  const semanticCheck = verifySemanticTokenPreservation(
    originalTokens,
    repairedTokens,
  );
  if (!semanticCheck.valid) {
    return {
      valid: false,
      message: semanticCheck.message.replace(
        "Deterministic JSON repair",
        "Model JSON syntax repair",
      ),
    };
  }
  const originalCounts = tokenCounts(originalTokens);
  const repairedCounts = tokenCounts(repairedTokens);
  const addedDuplicates = [...repairedCounts.entries()]
    .filter(([key, count]) => count > (originalCounts.get(key) ?? 0))
    .map(([key]) => key);
  if (addedDuplicates.length) {
    return {
      valid: false,
      message: `Model JSON syntax repair added duplicate scalar tokens: ${JSON.stringify(addedDuplicates.slice(0, 8))}.`,
    };
  }
  return {
    valid: true,
    originalSemanticFingerprint: semanticFingerprint(originalTokens),
    repairedSemanticFingerprint: semanticFingerprint(repairedTokens),
  };
}

function stripMarkdownFenceLines(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineStart = 0;
  while (lineStart < input.length) {
    const newlineIndex = input.indexOf("\n", lineStart);
    const lineEnd = newlineIndex < 0 ? input.length : newlineIndex + 1;
    const line = input.slice(lineStart, lineEnd);
    if (!inString && line.trimStart().startsWith("```")) {
      lineStart = lineEnd;
      continue;
    }
    output += line;
    for (const char of line) {
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
      } else if (char === "\"") {
        inString = true;
      }
    }
    lineStart = lineEnd;
  }
  return output;
}

function semanticTokens(input: string): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "\"") {
      const end = findStringEnd(input, index);
      if (end < 0) break;
      const literal = input.slice(index, end + 1);
      try {
        tokens.push({ type: "string", value: JSON.parse(literal) as string });
      } catch {
        // An invalid string escape remains the repairer's responsibility. It is
        // deliberately absent from the baseline, so an invented replacement
        // will fail the semantic set comparison below.
      }
      index = end + 1;
      continue;
    }
    const number = readJsonNumber(input, index);
    if (number) {
      tokens.push({ type: "number", value: canonicalNumber(number.value) });
      index = number.end;
      continue;
    }
    const literal = readJsonLiteral(input, index);
    if (literal) {
      tokens.push({ type: "literal", value: literal.value });
      index = literal.end;
      continue;
    }
    index += 1;
  }
  return tokens;
}

function verifySemanticTokenPreservation(
  original: SemanticToken[],
  repaired: SemanticToken[],
): { valid: true } | { valid: false; message: string } {
  const originalUnique = uniqueTokens(original);
  const repairedUnique = uniqueTokens(repaired);
  const originalKeys = originalUnique.map(tokenKey);
  const repairedKeys = repairedUnique.map(tokenKey);
  const added = repairedKeys.filter((key) => !originalKeys.includes(key));
  const removed = originalKeys.filter((key) => !repairedKeys.includes(key));
  if (added.length || removed.length) {
    return {
      valid: false,
      message: `Deterministic JSON repair changed semantic scalars; added=${JSON.stringify(added.slice(0, 8))}, removed=${JSON.stringify(removed.slice(0, 8))}.`,
    };
  }
  if (originalKeys.join("\u0000") !== repairedKeys.join("\u0000")) {
    return {
      valid: false,
      message: "Deterministic JSON repair reordered semantic scalars.",
    };
  }
  return { valid: true };
}

function uniqueTokens(tokens: SemanticToken[]): SemanticToken[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = tokenKey(token);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenCounts(tokens: SemanticToken[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const key = tokenKey(token);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function tokenKey(token: SemanticToken): string {
  return `${token.type}:${JSON.stringify(token.value)}`;
}

function semanticFingerprint(tokens: SemanticToken[]): string {
  return createHash("sha256")
    .update(JSON.stringify(uniqueTokens(tokens).map(tokenKey)))
    .digest("hex");
}

function findStringEnd(input: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "\"") {
      return index;
    }
  }
  return -1;
}

function readJsonNumber(
  input: string,
  start: number,
): { value: string; end: number } | undefined {
  if (!isNumberStart(input[start])) return undefined;
  const previous = start > 0 ? input[start - 1] : "";
  if (isIdentifierCharacter(previous)) return undefined;
  let end = start;
  while (end < input.length && isNumberCharacter(input[end])) end += 1;
  const value = input.slice(start, end);
  const next = input[end] ?? "";
  if (isIdentifierCharacter(next) || !isFiniteJsonNumber(value)) return undefined;
  return { value, end };
}

function readJsonLiteral(
  input: string,
  start: number,
): { value: string; end: number } | undefined {
  for (const value of ["true", "false", "null"]) {
    if (!input.startsWith(value, start)) continue;
    const previous = start > 0 ? input[start - 1] : "";
    const next = input[start + value.length] ?? "";
    if (isIdentifierCharacter(previous) || isIdentifierCharacter(next)) continue;
    return { value, end: start + value.length };
  }
  return undefined;
}

function isNumberStart(char: string | undefined): boolean {
  return char === "-" || (char !== undefined && char >= "0" && char <= "9");
}

function isNumberCharacter(char: string | undefined): boolean {
  return char !== undefined
    && (char === "-" || char === "+" || char === "." || char === "e" || char === "E"
      || (char >= "0" && char <= "9"));
}

function isIdentifierCharacter(char: string | undefined): boolean {
  return char !== undefined
    && ((char >= "a" && char <= "z")
      || (char >= "A" && char <= "Z")
      || (char >= "0" && char <= "9")
      || char === "_");
}

function isFiniteJsonNumber(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "number" && Number.isFinite(parsed);
  } catch {
    return false;
  }
}

function canonicalNumber(value: string): string {
  const parsed = JSON.parse(value) as number;
  return Object.is(parsed, -0) ? "-0" : String(parsed);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

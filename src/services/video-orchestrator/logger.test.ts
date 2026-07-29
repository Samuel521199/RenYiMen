import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { logOnePromptVideo, onePromptVideoLogPath } from "./logger.ts";
import {
  jsonParseErrorDiagnostic,
  structuredContentDiagnostic,
  structuredContentDiff,
} from "./structured-output-diagnostics.ts";

test("structured debug logs retain complete failed and repaired model content", async () => {
  const previousLogDir = process.env.ONE_PROMPT_VIDEO_LOG_DIR;
  const logDir = await mkdtemp(path.join(tmpdir(), "one-prompt-video-log-"));
  process.env.ONE_PROMPT_VIDEO_LOG_DIR = logDir;
  const rawFailedContent = `{"failed":"${"x".repeat(2400)}"}`;
  const rawRepairedContent = `{"repaired":"${"y".repeat(2600)}"}`;

  try {
    await logOnePromptVideo("test.structured_output.failed", {
      rawFailedContent,
      rawRepairedContent,
    }, "warn");

    const line = (await readFile(onePromptVideoLogPath(), "utf8")).trim();
    const payload = JSON.parse(line) as {
      data: {
        rawFailedContent: string;
        rawRepairedContent: string;
      };
    };
    assert.equal(payload.data.rawFailedContent, rawFailedContent);
    assert.equal(payload.data.rawRepairedContent, rawRepairedContent);
  } finally {
    if (previousLogDir === undefined) delete process.env.ONE_PROMPT_VIDEO_LOG_DIR;
    else process.env.ONE_PROMPT_VIDEO_LOG_DIR = previousLogDir;
    await rm(logDir, { recursive: true, force: true });
  }
});

test("numeric token usage metrics survive redaction but token-like strings do not", async () => {
  const previousLogDir = process.env.ONE_PROMPT_VIDEO_LOG_DIR;
  const logDir = await mkdtemp(path.join(tmpdir(), "one-prompt-video-token-metric-"));
  process.env.ONE_PROMPT_VIDEO_LOG_DIR = logDir;
  try {
    await logOnePromptVideo("planning.route.complete", {
      inputTokens: 812,
      outputTokens: 246,
      accessToken: "private-token",
      nested: { inputTokens: "not-a-number" },
    });
    const line = (await readFile(onePromptVideoLogPath(), "utf8")).trim();
    const payload = JSON.parse(line) as {
      data: {
        inputTokens: number;
        outputTokens: number;
        accessToken: string;
        nested: { inputTokens: string };
      };
    };
    assert.equal(payload.data.inputTokens, 812);
    assert.equal(payload.data.outputTokens, 246);
    assert.equal(payload.data.accessToken, "[REDACTED]");
    assert.equal(payload.data.nested.inputTokens, "[REDACTED]");
  } finally {
    if (previousLogDir === undefined) delete process.env.ONE_PROMPT_VIDEO_LOG_DIR;
    else process.env.ONE_PROMPT_VIDEO_LOG_DIR = previousLogDir;
    await rm(logDir, { recursive: true, force: true });
  }
});

test("structured output diagnostics retain complete content after secret redaction", () => {
  const content = '{"api_key":"sk-secretsecret123","value":"kept"}';
  const diagnostic = structuredContentDiagnostic(content);
  assert.equal(diagnostic.contentLength, content.length);
  assert.equal(
    diagnostic.redactedFullContent,
    '{"api_key":"[REDACTED]","value":"kept"}',
  );
  assert.equal(diagnostic.contentSha256.length, 64);
  assert.equal(diagnostic.redactedFullContent.includes("secretsecret123"), false);
});

test("structured output diagnostics expose parse context and complete changed ranges", () => {
  const before = '{"items":[1 2],"token":"private-token"}';
  const after = '{"items":[1,2],"token":"private-token"}';
  const parseError = jsonParseErrorDiagnostic(
    new SyntaxError("Expected ',' at position 12 (line 1 column 13)"),
    before,
  );
  const diff = structuredContentDiff(before, after);
  assert.equal(parseError.position, 12);
  assert.equal(parseError.line, 1);
  assert.equal(parseError.column, 13);
  assert.equal(
    `${parseError.redactedContextBeforeError}${parseError.redactedContextAfterError}`,
    parseError.redactedContext,
  );
  assert.match(parseError.redactedContext ?? "", /"token":"\[REDACTED\]"/);
  assert.equal(diff.beforeChangedRedacted, " ");
  assert.equal(diff.afterChangedRedacted, ",");
});

test("the planner logs complete redacted parse and repair diagnostics", async () => {
  const plannerSource = await readFile(
    new URL("./three-stage-planner.ts", import.meta.url),
    "utf8",
  );

  assert.match(plannerSource, /originalOutput:\s*structuredContentDiagnostic\(content\)/);
  assert.match(plannerSource, /firstParseError:\s*jsonParseErrorDiagnostic\(parseError,\s*content\)/);
  assert.match(plannerSource, /repairInput:\s*structuredContentDiagnostic\(repairContent\)/);
  assert.match(plannerSource, /repairOutput:\s*structuredContentDiagnostic\(result\.content\)/);
  assert.match(plannerSource, /repairParseError:\s*jsonParseErrorDiagnostic/);
  assert.match(plannerSource, /contentDiff:\s*structuredContentDiff/);
  assert.match(plannerSource, /schemaFingerprint:\s*generatedJsonSchemaFingerprint/);
  assert.match(plannerSource, /streamChunkMode:\s*streamAssembly\.contentMode/);
  assert.doesNotMatch(plannerSource, /rawFailedContent:\s*content/);
  assert.doesNotMatch(plannerSource, /rawRepairedContent:\s*result\.content/);
});

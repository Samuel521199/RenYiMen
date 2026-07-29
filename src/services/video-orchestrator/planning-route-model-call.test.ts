import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_MODEL_CALL_POLICY,
  PLANNING_ROUTE_MODEL_ERROR_CODES,
  PLANNING_ROUTE_SYSTEM_PROMPT,
  PlanningRouteModelCallError,
  buildPlanningRouteChatRequest,
  planningRouteInputHasExplicitChronologyIntent,
  planningRouteContractMetadata,
  runPlanningRouteModelCall,
} from "./planning-route-model-call";
import { buildPlanningRouteInput } from "./planning-route-input-contract";

const input = buildPlanningRouteInput({
  userCreative: "制作一个30秒竖屏游戏广告。",
  durationSeconds: 30,
  aspectRatio: "9:16",
  stylePreset: "游戏广告",
  hasReferenceImage: true,
  referenceFacts: {
    subjectTypes: ["game_ui"],
    categorySignals: ["game"],
    containsUi: true,
    containsBrandElements: false,
    containsPeople: false,
    hasExplicitAdCategorySignals: true,
  },
  userConstraints: ["不要完整泄露最终奖励"],
});

function validRouteValue(): Record<string, unknown> {
  const metadata = planningRouteContractMetadata(input);
  return {
    videoCategory: "game",
    templateId: "game_bonus_payoff",
    chronologyMode: "chronological",
    hookMode: "tease",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "用户明确要求游戏广告。",
    templateReason: "参考事实显示奖励 UI。",
    chronologyReason: "用户未要求倒叙。",
    evidence: [{
      sourceType: "user_prompt",
      sourceField: "userCreative",
      summary: "用户明确要求游戏广告。",
      referenceFactField: null,
    }],
    categoryConfidence: 0.99,
    templateConfidence: 0.92,
    chronologyConfidence: 0.88,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    ...metadata,
  };
}

test("request uses the fixed lightweight model parameters", () => {
  const request = buildPlanningRouteChatRequest("test");
  assert.equal(request.model, "qwen3.7-plus");
  assert.equal(request.temperature, 0.1);
  assert.equal(request.enable_thinking, false);
  assert.equal(request.max_tokens, 450);
  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.equal(request.stream, false);
});

test("system prompt forbids prose, Markdown, story generation, and event references", () => {
  assert.match(PLANNING_ROUTE_SYSTEM_PROMPT, /No Markdown/);
  assert.match(PLANNING_ROUTE_SYSTEM_PROMPT, /Do not generate story events/);
  assert.match(PLANNING_ROUTE_SYSTEM_PROMPT, /hookEventIds/);
  assert.match(PLANNING_ROUTE_SYSTEM_PROMPT, /2048 bytes/);
});

test("normal valid output uses exactly one model call", async () => {
  let calls = 0;
  const content = JSON.stringify(validRouteValue());
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return content;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.repairCallCount, 0);
  assert.equal(result.gateStatus, "allow");
  assert.ok(result.outputBytes <= PLANNING_ROUTE_MODEL_CALL_POLICY.maxOutputBytes);
});

test("unrequested flashforward is repaired to chronological without another model call", async () => {
  let calls = 0;
  const route = validRouteValue();
  route.chronologyMode = "flashforward_hook";
  route.hookMode = "payoff_preview";
  route.hookRevealLevel = "partial";
  route.requiresReturnPoint = true;
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return JSON.stringify(route);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.value.chronologyMode, "chronological");
  assert.equal(result.value.requiresReturnPoint, false);
  assert.equal(result.gateStatus, "deterministic_repair");
  assert.equal(result.repairCallCount, 0);
});

test("explicit gameplay demonstration intent is not treated as an unspecified chronology", () => {
  assert.equal(planningRouteInputHasExplicitChronologyIntent(input), false);
  assert.equal(planningRouteInputHasExplicitChronologyIntent({
    ...input,
    userCreative: "逐步演示 Tongits 的玩法操作。",
  }), true);
});

test("OpenAI-compatible transport usage is accumulated into the route result", async () => {
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => ({
      content: JSON.stringify(validRouteValue()),
      inputTokens: 812,
      outputTokens: 246,
    }),
  });
  assert.equal(result.inputTokens, 812);
  assert.equal(result.outputTokens, 246);
  assert.ok(result.apiWaitDurationMs >= 0);
  assert.ok(result.inputCharacterCount > 0);
  assert.equal(result.responseCharacterCount, JSON.stringify(validRouteValue()).length);
});

test("explicit unsupported content blocks Planning without calling the model", async () => {
  let calls = 0;
  const result = await runPlanningRouteModelCall({
    input,
    unsupportedContentReason: "当前系统不支持该媒体类型",
    transport: async () => {
      calls += 1;
      return JSON.stringify(validRouteValue());
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.attemptCount, 0);
  assert.equal(result.gateStatus, "fallback");
  assert.equal(result.fallbackInfo?.shouldBlockPlanning, true);
  assert.match(result.fallbackInfo?.userVisibleWarning ?? "", /Planning 已停止/);
});

test("invalid JSON does not qualify for model repair and falls back after one call", async () => {
  const requests: string[] = [];
  const result = await runPlanningRouteModelCall({
    input,
    transport: async (request) => {
      requests.push(request.messages[1]?.content ?? "");
      return "```json\n{}\n```";
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(result.repairCallCount, 0);
  assert.equal(result.gateStatus, "fallback");
  assert.equal(result.repairTrigger, null);
});

test("approved game-template ambiguity receives exactly one targeted repair call", async () => {
  const requests: string[] = [];
  const ambiguous = validRouteValue();
  delete ambiguous.templateId;
  ambiguous.ambiguityCodes = ["TEMPLATE_CONFLICT"];
  const result = await runPlanningRouteModelCall({
    input,
    transport: async (request) => {
      requests.push(request.messages[1]?.content ?? "");
      return requests.length === 1
        ? JSON.stringify(ambiguous)
        : JSON.stringify(validRouteValue());
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(result.repairCallCount, 1);
  assert.equal(result.repairTrigger, "PLANNING_ROUTE_REPAIR_GAME_TEMPLATE_AMBIGUOUS");
  assert.match(requests[1] ?? "", /one and only one targeted repair/);
  assert.match(requests[1] ?? "", /mutable_fields/);
  assert.match(requests[1] ?? "", /immutable facts/);
});

test("a failed targeted repair uses safe fallback without a third call", async () => {
  let calls = 0;
  const ambiguous = validRouteValue();
  delete ambiguous.templateId;
  ambiguous.ambiguityCodes = ["TEMPLATE_CONFLICT"];
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return calls === 1 ? JSON.stringify(ambiguous) : "{}";
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.gateStatus, "fallback");
  assert.equal(result.value.videoCategory, "custom");
});

test("targeted repair cannot change protected evidence or metadata", async () => {
  let calls = 0;
  const ambiguous = validRouteValue();
  delete ambiguous.templateId;
  ambiguous.ambiguityCodes = ["TEMPLATE_CONFLICT"];
  const changed = validRouteValue();
  changed.evidence = [{
    sourceType: "user_prompt",
    sourceField: "userCreative",
    summary: "rewritten fact",
    referenceFactField: null,
  }];
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return calls === 1 ? JSON.stringify(ambiguous) : JSON.stringify(changed);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.gateStatus, "fallback");
  assert.ok(result.repairFailureReasons.some((item) => item.includes("protected field evidence")));
});

test("caller cancellation stops the call and does not trigger repair", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  let calls = 0;
  await assert.rejects(
    runPlanningRouteModelCall({
      input,
      signal: controller.signal,
      transport: async (_request, signal) => {
        calls += 1;
        if (signal.aborted) throw signal.reason;
        return JSON.stringify(validRouteValue());
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PlanningRouteModelCallError);
      assert.equal(error.code, PLANNING_ROUTE_MODEL_ERROR_CODES.CANCELLED);
      assert.equal(error.attemptCount, 0);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("hard timeout covers the whole route stage and does not trigger repair", async () => {
  let calls = 0;
  await assert.rejects(
    runPlanningRouteModelCall({
      input,
      hardTimeoutMs: 10,
      transport: async (_request, signal) => {
        calls += 1;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        return JSON.stringify(validRouteValue());
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PlanningRouteModelCallError);
      assert.equal(error.code, PLANNING_ROUTE_MODEL_ERROR_CODES.TIMEOUT);
      assert.ok(error.apiWaitDurationMs > 0);
      assert.ok(error.inputCharacterCount > 0);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("oversized output is never accepted", async () => {
  let calls = 0;
  await assert.rejects(
    runPlanningRouteModelCall({
      input,
      transport: async () => {
        calls += 1;
        const value = validRouteValue();
        value.categoryReason = "x".repeat(PLANNING_ROUTE_MODEL_CALL_POLICY.maxOutputBytes + 1);
        return JSON.stringify(value);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PlanningRouteModelCallError);
      assert.equal(error.code, PLANNING_ROUTE_MODEL_ERROR_CODES.OUTPUT_TOO_LARGE);
      return true;
    },
  );
  assert.equal(calls, 1);
});

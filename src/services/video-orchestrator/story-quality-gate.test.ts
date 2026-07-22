import assert from "node:assert/strict";
import { test } from "node:test";
import { decideStoryRewrite, evaluateStoryQualityGate, markStoryRewriteRequired } from "./story-quality-gate";
import type { OnePromptVideoPlan, VideoPlanSegment } from "./types";

function makeSegment(partial: Partial<VideoPlanSegment> & Pick<VideoPlanSegment, "segmentNo">): VideoPlanSegment {
  const segment: VideoPlanSegment = {
    startKeyframeNo: partial.startKeyframeNo ?? partial.segmentNo,
    endKeyframeNo: partial.endKeyframeNo ?? partial.segmentNo + 1,
    startTimeSeconds: partial.startTimeSeconds ?? 0,
    endTimeSeconds: partial.endTimeSeconds ?? 4,
    durationSeconds: partial.durationSeconds ?? 4,
    purpose: partial.purpose ?? "",
    motion: partial.motion ?? "",
    camera: partial.camera ?? "",
    subjectMotion: partial.subjectMotion ?? "",
    environmentMotion: partial.environmentMotion ?? "",
    videoPrompt: partial.videoPrompt ?? "",
    subtitle: partial.subtitle ?? "",
    negativePrompt: partial.negativePrompt ?? "",
    ...partial,
  };
  return segment;
}

function makePlan(partial: Partial<OnePromptVideoPlan>): OnePromptVideoPlan {
  return {
    title: "Story quality gate fixture",
    logline: "Fixture",
    durationSeconds: 12,
    aspectRatio: "9:16",
    keyframeCount: 0,
    segmentCount: partial.segments?.length ?? 0,
    styleBible: {
      visualStyle: "test",
      characterLock: "test",
      colorPalette: "test",
      negativePrompt: "test",
    },
    keyframes: [],
    segments: [],
    shots: [],
    ...partial,
  } as OnePromptVideoPlan;
}

test("story quality gate flags sudden game payoff without visible trigger", () => {
  const report = evaluateStoryQualityGate(makePlan({
    creativeStrategy: {
      videoCategory: "game",
      templateId: "game_reversal",
      conversionGoal: "download",
      hook: "牛只剩最后一枚金币",
      conflict: "对手嘲笑它不敢下注",
      payoff: "牛突然赢了",
    },
    storyBeats: [
      {
        beatId: "beat-hook",
        order: 1,
        storyFunction: "hook",
        titleZh: "牛陷入牌局劣势",
        informationUnit: "逆风压力",
      },
      {
        beatId: "beat-payoff",
        order: 2,
        storyFunction: "payoff",
        titleZh: "牛突然赢了",
        effect: "胜利和金币爆发",
        informationUnit: "胜利结果",
        targetSegmentNos: [1],
      },
    ],
    segments: [
      makeSegment({
        segmentNo: 1,
        linkedBeatIds: ["beat-payoff"],
        storyFunction: "payoff",
        purpose: "牛突然赢了",
        effect: "胜利和金币爆发",
        informationUnit: "胜利结果",
        videoPrompt: "The bull suddenly wins the poker match.",
      }),
    ],
  }));

  assert.equal(report.rewriteRequired, false);
  assert.ok(report.issueCodes?.includes("suddenOutcomeRisk"));
});

test("story quality rewrite decision sends causal shot failures back to storyboard", () => {
  const report = evaluateStoryQualityGate(makePlan({
    creativeStrategy: {
      videoCategory: "game",
      templateId: "game_reversal",
      conversionGoal: "download",
      hook: "牛只剩最后一枚金币",
      conflict: "对手嘲笑它不敢下注",
      turningPoint: "牛触发最后操作",
      payoff: "牛翻盘赢了",
      cta: "Play now",
    },
    storyBeats: [
      {
        beatId: "beat-hook",
        order: 1,
        storyFunction: "hook",
        titleZh: "逆风开局",
        informationUnit: "逆风压力",
      },
      {
        beatId: "beat-payoff",
        order: 2,
        storyFunction: "payoff",
        titleZh: "牛突然赢了",
        effect: "胜利和金币爆发",
        informationUnit: "胜利结果",
        reactionBeat: "朋友欢呼",
        targetSegmentNos: [1],
      },
      {
        beatId: "beat-cta",
        order: 3,
        storyFunction: "cta",
        titleZh: "立即试玩",
        informationUnit: "下载行动",
        targetSegmentNos: [2],
      },
    ],
    segments: [
      makeSegment({
        segmentNo: 1,
        linkedBeatIds: ["beat-payoff"],
        storyFunction: "payoff",
        purpose: "牛突然赢了",
        effect: "胜利和金币爆发",
        informationUnit: "胜利结果",
        reactionBeat: "朋友欢呼",
        videoPrompt: "The bull suddenly wins the poker match.",
      }),
      makeSegment({
        segmentNo: 2,
        linkedBeatIds: ["beat-cta"],
        storyFunction: "cta",
        purpose: "CTA",
        cause: "玩家看到胜利结果",
        effect: "引导下载",
        informationUnit: "下载行动",
        videoPrompt: "Download CTA.",
      }),
    ],
  }));

  const decision = decideStoryRewrite(report);
  assert.equal(decision.shouldRewrite, true);
  assert.equal(decision.stage, "storyboard");
  assert.ok(decision.reasons.some((reason) => reason.includes("suddenOutcomeRisk")));
});

test("story quality gate flags reference-only animation plans", () => {
  const report = evaluateStoryQualityGate(makePlan({
    creativeStrategy: {
      videoCategory: "brand",
      templateId: "generic_brand_story",
      conversionGoal: "awareness",
      referenceUsageStrategyZh: "只展示参考图，让参考图动起来",
    },
    segments: [
      makeSegment({
        segmentNo: 1,
        purpose: "展示参考图",
        videoPrompt: "Make the reference image move and showcase the original artwork.",
        informationUnit: "展示参考图",
      }),
      makeSegment({
        segmentNo: 2,
        purpose: "继续展示参考图",
        videoPrompt: "Animate the reference image with light camera movement.",
        informationUnit: "展示参考图",
      }),
    ],
  }));

  assert.ok(report.issueCodes?.includes("referenceOveruseRisk"));
  assert.ok((report.issues ?? []).every((issue) => issue.severity === "warning"));
  const decision = decideStoryRewrite(report);
  assert.equal(decision.stage, "creative_strategy");
});

test("story quality gate flags product ads without pain point and proof", () => {
  const report = evaluateStoryQualityGate(makePlan({
    creativeStrategy: {
      videoCategory: "product",
      templateId: "product_problem_solution",
      conversionGoal: "purchase",
      payoff: "产品出现",
    },
    storyBeats: [
      {
        beatId: "beat-product",
        order: 1,
        storyFunction: "payoff",
        titleZh: "产品出现",
        informationUnit: "品牌展示",
      },
    ],
    segments: [
      makeSegment({
        segmentNo: 1,
        linkedBeatIds: ["beat-product"],
        storyFunction: "payoff",
        purpose: "展示产品",
        informationUnit: "品牌展示",
        videoPrompt: "Show the product beautifully.",
      }),
    ],
  }));

  assert.ok(report.issueCodes?.includes("productPainPointMissingRisk"));
  assert.ok(report.issueCodes?.includes("productProofMissingRisk"));
  assert.equal(report.rewriteRequired, false);
  const decision = decideStoryRewrite(report);
  assert.equal(decision.shouldRewrite, true);
  assert.equal(decision.stage, "creative_strategy");
});

test("story quality gate marks rewriteRequired only after auto rewrite attempts are exhausted", () => {
  const plan = makePlan({
    creativeStrategy: {
      videoCategory: "brand",
      templateId: "generic_brand_story",
      conversionGoal: "awareness",
    },
    segments: [
      makeSegment({
        segmentNo: 1,
        purpose: "Only showcase reference",
        videoPrompt: "Animate the reference image.",
      }),
    ],
  });
  const evaluatedPlan = { ...plan, storyQualityReport: evaluateStoryQualityGate(plan) };
  const marked = markStoryRewriteRequired(evaluatedPlan, 2);

  assert.equal(marked.storyQualityReport?.rewriteRequired, true);
  assert.equal(marked.storyQualityReport?.autoRewriteAttempts, 2);
  assert.notEqual(marked.storyQualityReport?.rewriteFromStage, "none");
  assert.ok((marked.storyQualityReport?.rewriteReasons ?? []).length > 0);
});

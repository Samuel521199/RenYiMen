import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { decideStoryRewrite, evaluateStoryQualityGate } from "./story-quality-gate";
import type { OnePromptVideoPlan, VideoPlanSegment, VideoStoryBeat } from "./types";

type JsonRecord = Record<string, unknown>;

const workspaceRoot = process.cwd();
const fixturePath = path.join(
  workspaceRoot,
  "src",
  "services",
  "video-orchestrator",
  "__fixtures__",
  "story-quality",
  "acceptance-samples.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as JsonRecord;
const samples = asArray(fixture.samples).map(asRecord);
const qualityGate = asRecord(fixture.qualityGate);
const forbiddenIssueCodes = new Set(asArray(qualityGate.forbiddenIssueCodes).map(String));
const minimumScore = Number(qualityGate.minimumScore);

function asRecord(value: unknown): JsonRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as unknown[];
}

function clonePlan(plan: OnePromptVideoPlan): OnePromptVideoPlan {
  return JSON.parse(JSON.stringify(plan)) as OnePromptVideoPlan;
}

function planFromSample(sample: JsonRecord): OnePromptVideoPlan {
  return asRecord(sample.planJson) as unknown as OnePromptVideoPlan;
}

function beatFunctions(plan: OnePromptVideoPlan): Set<string> {
  return new Set((plan.storyBeats ?? []).map((beat) => beat.storyFunction).filter(Boolean));
}

function segmentByFunction(plan: OnePromptVideoPlan, storyFunction: string): VideoPlanSegment[] {
  return (plan.segments ?? []).filter((segment) => segment.storyFunction === storyFunction);
}

test("story quality fixtures cover every initial video category", () => {
  assert.equal(fixture.capturedForStep, "16.10-phase9-story-regression");
  const categories = new Set(samples.map((sample) => String(sample.videoCategory)));
  for (const category of ["game", "product", "ecommerce", "food", "auto", "short_drama", "brand"]) {
    assert.ok(categories.has(category), `missing story-quality fixture category: ${category}`);
  }
});

for (const sample of samples) {
  const sampleId = String(sample.sampleId);

  test(`${sampleId} contains the required story plan contract`, () => {
    const plan = planFromSample(sample);
    assert.equal(plan.creativeStrategy?.videoCategory, sample.videoCategory);
    assert.equal(plan.creativeStrategy?.templateId, sample.templateId);
    assert.ok(plan.creativeStrategy?.templateReason);
    assert.ok(plan.creativeStrategy?.conversionGoal);
    assert.ok(plan.creativeStrategy?.hook);
    assert.ok(plan.creativeStrategy?.conflict);
    assert.ok(plan.creativeStrategy?.payoff);
    assert.ok(plan.creativeStrategy?.cta);
    assert.ok((plan.storyBeats ?? []).length >= 5, "storyBeats must contain a complete beat sheet");
    assert.ok(plan.narrativeMicroRules || sample.videoCategory !== "game", "game sample must freeze narrative micro-rules");
    assert.ok(plan.shotGroupingPass);
    assert.ok((plan.shotGroupingPass?.groups ?? []).length > 0, "shotGroupingPass.groups must be present");
    assert.ok(Array.isArray(plan.shotGroupingPass?.splitReasons), "shotGroupingPass.splitReasons must be present");
    assert.ok(plan.storyQualityReport, "fixture must persist storyQualityReport");

    const functions = beatFunctions(plan);
    for (const required of ["hook", "conflict", "payoff", "cta"]) {
      assert.ok(functions.has(required), `${sampleId} missing beat function: ${required}`);
    }

    for (const segment of plan.segments ?? []) {
      assert.ok(segment.linkedBeatIds?.length, `${sampleId} segment ${segment.segmentNo} missing linkedBeatIds`);
      assert.ok(segment.storyFunction, `${sampleId} segment ${segment.segmentNo} missing storyFunction`);
      assert.ok(segment.cause, `${sampleId} segment ${segment.segmentNo} missing cause`);
      assert.ok(segment.effect, `${sampleId} segment ${segment.segmentNo} missing effect`);
      assert.ok(segment.informationUnit, `${sampleId} segment ${segment.segmentNo} missing informationUnit`);
      assert.ok(segment.keyEvidenceIds?.length, `${sampleId} segment ${segment.segmentNo} missing keyEvidenceIds`);
    }
  });

  test(`${sampleId} passes the Story Quality Gate hard metrics`, () => {
    const plan = planFromSample(sample);
    const report = evaluateStoryQualityGate(plan);
    const issueCodes = new Set(report.issueCodes ?? []);

    assert.equal(report.passed, true, `${sampleId} issues: ${JSON.stringify(report.issues ?? [])}`);
    assert.ok((report.score ?? 0) >= minimumScore, `${sampleId} score ${report.score} below ${minimumScore}`);
    for (const code of forbiddenIssueCodes) {
      assert.equal(issueCodes.has(code), false, `${sampleId} should not emit ${code}`);
    }
    assert.equal(decideStoryRewrite(report).shouldRewrite, false, `${sampleId} should not request rewrite`);
  });
}

test("game fixture explicitly covers underdog, choice, mechanism trigger, payoff, reaction, and CTA", () => {
  const sample = samples.find((item) => item.sampleId === "game-reversal-bull-card");
  assert.ok(sample);
  assert.deepEqual(asArray(sample.requiredCoverage).map(String), ["underdog", "choice", "mechanism_trigger", "payoff", "reaction", "cta"]);
  const plan = planFromSample(sample);
  const beats = plan.storyBeats ?? [];
  const functions = beats.map((beat) => beat.storyFunction);

  for (const required of ["hook", "conflict", "turning_point", "payoff", "reaction", "cta"]) {
    assert.ok(functions.includes(required as VideoStoryBeat["storyFunction"]), `game fixture missing ${required}`);
  }

  const turning = beats.find((beat) => beat.storyFunction === "turning_point");
  const payoff = beats.find((beat) => beat.storyFunction === "payoff");
  assert.ok(turning?.actionContinuity?.execution?.toLowerCase().includes("button"));
  assert.ok(payoff?.cause?.toLowerCase().includes("bonus"));
  assert.ok(payoff?.reactionBeat);
  assert.ok(segmentByFunction(plan, "payoff").every((segment) => segment.cause && segment.actionContinuity && segment.reactionBeat));
});

test("product fixture explicitly covers pain point, use, proof, brand memory, and CTA", () => {
  const sample = samples.find((item) => item.sampleId === "product-skincare-proof");
  assert.ok(sample);
  assert.deepEqual(asArray(sample.requiredCoverage).map(String), ["pain_point", "use", "proof", "brand_memory", "cta"]);
  const plan = planFromSample(sample);
  const beats = plan.storyBeats ?? [];

  assert.ok(beats.some((beat) => beat.storyFunction === "hook" && /dry|pain/i.test([beat.title, beat.informationUnit].join(" "))));
  assert.ok(beats.some((beat) => beat.storyFunction === "turning_point" && /drops|appl/i.test([beat.title, beat.informationUnit, beat.actionContinuity?.execution].join(" "))));
  assert.ok(beats.some((beat) => beat.storyFunction === "proof" && /meter|proof|hydration/i.test([beat.title, beat.informationUnit, ...(beat.keyEvidenceIds ?? [])].join(" "))));
  assert.ok(beats.some((beat) => beat.storyFunction === "payoff" && /brand|bottle/i.test([beat.title, beat.informationUnit, ...(beat.keyEvidenceIds ?? [])].join(" "))));
  assert.ok(beats.some((beat) => beat.storyFunction === "cta" && /purchase|shop|try/i.test([beat.title, beat.informationUnit, beat.cause].join(" "))));
});

test("reference-only animation regression fails the fixed story gate", () => {
  const plan = clonePlan(planFromSample(samples.find((item) => item.sampleId === "generic-brand-story") ?? samples[0]));
  plan.creativeStrategy = {
    videoCategory: "brand",
    templateId: "generic_brand_story",
    conversionGoal: "awareness",
    referenceUsageStrategy: "Only animate the reference image and make the image move.",
  };
  plan.storyBeats = [];
  plan.segments = [
    {
      segmentNo: 1,
      startKeyframeNo: 1,
      endKeyframeNo: 2,
      startTimeSeconds: 0,
      endTimeSeconds: 5,
      durationSeconds: 5,
      purpose: "Showcase reference image",
      motion: "make reference image move",
      camera: "slow zoom",
      subjectMotion: "reference artwork moves",
      environmentMotion: "light sweep",
      videoPrompt: "Animate the reference image and showcase the original picture.",
      subtitle: "",
      negativePrompt: "",
      informationUnit: "reference image showcase",
    },
  ];

  const report = evaluateStoryQualityGate(plan);
  assert.equal(report.passed, false);
  assert.ok(report.issueCodes?.includes("referenceOveruseRisk"));
  assert.equal(decideStoryRewrite(report).stage, "creative_strategy");
});

test("payoff without a visible trigger fails with suddenOutcomeRisk", () => {
  const sample = samples.find((item) => item.sampleId === "game-reversal-bull-card");
  assert.ok(sample);
  const plan = clonePlan(planFromSample(sample));
  for (const beat of plan.storyBeats ?? []) {
    if (beat.storyFunction === "turning_point") {
      beat.cause = "";
      beat.keyEvidenceIds = [];
      beat.requiredAnchorIds = [];
      beat.actionContinuity = undefined;
    }
    if (beat.storyFunction === "payoff") {
      beat.cause = "";
    }
  }
  for (const segment of plan.segments ?? []) {
    if (segment.storyFunction === "turning_point") {
      segment.cause = "";
      segment.keyEvidenceIds = [];
      segment.usesConsistencyAnchors = [];
      segment.actionContinuity = undefined;
    }
    if (segment.storyFunction === "payoff") {
      segment.cause = "";
    }
  }

  const report = evaluateStoryQualityGate(plan);
  assert.equal(report.passed, false);
  assert.ok(report.issueCodes?.includes("suddenOutcomeRisk"));
  assert.equal(decideStoryRewrite(report).stage, "storyboard");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assetSubjectPromptInstruction,
  buildAssetConsistencyReference,
  resolveImageTargetDependencyScope,
} from "./project-service.ts";
import { buildAuthoritativeVisualContract } from "./visual-quality-contract.ts";
import {
  compileAssetImagePromptZh,
  validateAssetImageContract,
} from "./asset-image-contract.ts";
import type { VideoConsistencyAnchor } from "./types.ts";

const playingCards = {
  id: "game_cards",
  type: "prop",
  displayNameZh: "扑克牌",
  displayNameEn: "Playing Cards",
  descriptionZh: "标准扑克牌，卡通风格，可见 A 与 K。",
  descriptionEn: "Standard cartoon playing cards with visible A and K.",
} as VideoConsistencyAnchor;

test("playing-card asset prompt fixes count, rank, suit, orientation, and layout", () => {
  const prompt = assetSubjectPromptInstruction(playingCards, "prop", "zh");
  assert.match(prompt, /严格只显示两张/);
  assert.match(prompt, /左侧黑桃 A/);
  assert.match(prompt, /右侧红桃 K/);
  assert.match(prompt, /正上方无透视俯视/);
  assert.match(prompt, /不得重叠/);
  assert.match(prompt, /左上角和右下角必须显示完全一致/);
  assert.match(prompt, /禁止出现第三张牌/);
});

test("intrinsic card markings are explicitly distinguished from random text", () => {
  const zh = assetSubjectPromptInstruction(playingCards, "prop", "zh");
  const en = assetSubjectPromptInstruction(playingCards, "prop", "en");
  assert.match(zh, /牌面固有标记，不属于随机文字/);
  assert.match(en, /mandatory intrinsic markings, not incidental text/);
  assert.match(en, /Ace of Spades on the left and King of Hearts on the right/);
});

test("ordinary props do not receive playing-card-specific requirements", () => {
  const chip = {
    ...playingCards,
    id: "poker_chips",
    displayNameZh: "筹码",
    displayNameEn: "Poker Chips",
    descriptionZh: "圆形彩色筹码",
    descriptionEn: "Round colored chips",
  } as VideoConsistencyAnchor;
  assert.equal(assetSubjectPromptInstruction(chip, "prop", "zh"), "");
});

test("isolated asset dependency scope ignores global story anchors", () => {
  const plan = {
    consistencyManifest: {
      anchors: [
        { id: "hero_bull", type: "person" },
        { id: "opponent_bull", type: "person" },
        { id: "card_table_scene", type: "location" },
        { id: "game_cards", type: "prop" },
      ],
    },
  };
  const target = {
    anchorId: "opponent_bull",
    assetCategory: "person",
    assetView: "front",
    effectiveRequiredAnchorIds: ["hero_bull", "opponent_bull", "card_table_scene", "game_cards"],
  };
  const scope = resolveImageTargetDependencyScope(plan as never, target, -1003);
  assert.deepEqual(scope.requiredAnchorIds, ["opponent_bull"]);
  assert.deepEqual(scope.forbiddenAnchorIds, ["hero_bull", "card_table_scene", "game_cards"]);
  assert.equal(scope.targetAnchorId, "opponent_bull");
  assert.equal(scope.isolatedAsset, true);
});

test("asset reference compiler does not inherit unrelated base-reference state", () => {
  const baseReference = {
    kind: "character",
    needed: true,
    keyframeNo: -1,
    purpose: "legacy",
    scene: "beach card table",
    characterState: "hero bull and opponent bull seated together",
    productState: "cards and chips visible",
    imagePrompt: "legacy scene",
    negativePrompt: "",
  } as const;
  const person = buildAssetConsistencyReference({
    item: {
      assetId: "opponent_bull:front",
      category: "person",
      view: "front",
      keyframeNo: -1003,
      anchorId: "opponent_bull",
      required: true,
    },
    anchor: {
      id: "opponent_bull",
      type: "person",
      mustStayConsistent: true,
      needsReferenceImage: true,
      descriptionEn: "One opponent bull.",
    },
    baseReference: baseReference as never,
    userPrompt: "game ad",
    negativePrompt: "",
  });
  assert.equal(person.scene, "plain white or light neutral asset-library background");
  assert.equal(person.productState, "");
  assert.match(person.characterState, /opponent_bull:front/);

  const prop = buildAssetConsistencyReference({
    item: {
      assetId: "poker_chips:single",
      category: "prop",
      view: "single",
      keyframeNo: -1008,
      anchorId: "poker_chips",
      required: true,
    },
    anchor: {
      id: "poker_chips",
      type: "prop",
      mustStayConsistent: true,
      needsReferenceImage: true,
      descriptionEn: "Bright cartoon poker chips.",
    },
    baseReference: baseReference as never,
    userPrompt: "game ad",
    negativePrompt: "",
  });
  assert.equal(prop.characterState, "");
  assert.equal(prop.scene, "plain white or light neutral asset-library background");
});

test("isolated props preserve intrinsic markings without enabling full game UI", () => {
  const contract = buildAuthoritativeVisualContract({
    targetContract: {
      isolationMode: "single_asset",
      assetCategory: "prop",
      imagePrompt: "Two playing cards with visible A and K on a plain white background; no UI.",
    },
    prompt: "Render only the two cards. No HUD, logo, title, score, or interface.",
    negativePrompt: "game UI, HUD, title, logo",
    mediaStage: "static_image",
    hasApprovedReferences: false,
  });
  assert.equal(contract.allowGameUi, false);
});

test("planning rejects a generic scene-summary prompt without an executable asset contract", () => {
  const scene = {
    id: "beach_card_table_scene",
    type: "location",
    mustStayConsistent: true,
    needsReferenceImage: true,
    referenceStrength: "hard",
    imagePromptZh: "可复用场景空间参考图，广角总览，固定空间布局、光线方向、色彩氛围、主要背景结构和空间关系，明亮卡通风格。",
  } as VideoConsistencyAnchor;
  const issues = validateAssetImageContract(scene);
  assert.ok(issues.some((issue) => issue.field === "assetImageContract"));
});

test("planning rejects a person sheet that permits multiple characters", () => {
  const person = {
    id: "opponent_bull",
    type: "person",
    mustStayConsistent: true,
    needsReferenceImage: true,
    assetImageContract: {
      subjectCount: 2,
      subjectDescription: "棕色公牛角色，短角、圆鼻、绿色背心",
      composition: {
        framing: "全身像",
        cameraAngle: "正面平视",
        placement: "人物严格居中",
        occupancy: "占画面高度约75%",
      },
      environment: { background: "纯浅灰色无缝摄影棚背景" },
      lighting: { direction: "左前方45度", quality: "柔光并保留右侧轻微阴影" },
      intrinsicDetails: ["短而上翘的牛角", "圆形浅棕鼻口", "绿色无袖背心"],
      forbiddenElements: ["第二个人物", "场景", "文字", "Logo", "UI"],
      acceptanceCriteria: ["角色全身和双脚完整可见", "服装与角的形状清楚可辨"],
    },
  } as VideoConsistencyAnchor;
  assert.ok(validateAssetImageContract(person).some((issue) => issue.message.includes("exactly one")));
});

test("planning scene contract compiles measurable foreground-midground-background instructions", () => {
  const scene = {
    id: "beach_card_table_scene",
    type: "location",
    displayNameZh: "海滩牌桌场景",
    mustStayConsistent: true,
    needsReferenceImage: true,
    referenceStrength: "hard",
    imagePromptZh: "temporary prompt that is deliberately long enough to be replaced by the canonical structured contract output",
    imagePromptEn: "temporary prompt that is deliberately long enough to be replaced by the canonical structured contract output",
    assetImageContract: {
      subjectCount: 1,
      subjectDescription: "一张椭圆形蓝色绒面木边牌桌，位于热带沙滩的固定游戏区",
      composition: {
        framing: "9:16 竖幅广角全景",
        cameraAngle: "相机高于桌面约1.6米，向下俯拍15度，朝向海面",
        placement: "牌桌中心位于画面水平中线并略低于垂直中心",
        occupancy: "牌桌占画面宽度约55%，占高度约28%",
      },
      environment: {
        background: "无遮挡的热带沙滩游戏区",
        foreground: "浅金色细沙与牌桌前侧两条桌腿，不出现其他道具",
        midground: "单张蓝色椭圆牌桌，桌沿完整可见",
        backgroundLayer: "右后方青蓝海面与水平地平线，左后方三棵椰树",
        spatialRelationships: [
          "牌桌后沿距离海岸线在画面中约为桌面短轴的一倍",
          "椰树全部位于牌桌左后方，树干不得与桌面重叠",
        ],
      },
      lighting: {
        direction: "阳光从画面左上方照向右下方",
        quality: "柔和但方向明确，桌腿阴影投向右下方",
        colorTemperature: "暖中性日光约5200K",
      },
      palette: ["海水青蓝 #37B8D4", "桌面深蓝 #176B8E", "沙滩浅金 #E8C982"],
      materialDetails: ["桌面为短绒蓝色毡面", "桌沿和桌腿为暖棕色哑光木材"],
      intrinsicDetails: ["椭圆桌面长宽比约1.7:1", "四条向外微张的短桌腿"],
      forbiddenElements: ["人物", "扑克牌", "筹码", "文字", "Logo", "游戏UI"],
      acceptanceCriteria: [
        "一眼可确认只有一张完整牌桌且四条桌腿可辨认",
        "前景沙地、中景牌桌、远景海面与椰树的层次关系清晰",
      ],
    },
  } as VideoConsistencyAnchor;

  assert.deepEqual(validateAssetImageContract(scene), []);
  const prompt = compileAssetImagePromptZh(scene);
  assert.match(prompt, /俯拍15度/);
  assert.match(prompt, /牌桌占画面宽度约55%/);
  assert.match(prompt, /前景=浅金色细沙/);
  assert.match(prompt, /中景=单张蓝色椭圆牌桌/);
  assert.match(prompt, /远景=右后方青蓝海面/);
  assert.match(prompt, /桌腿阴影投向右下方/);
  assert.match(prompt, /禁止出现：人物、扑克牌、筹码、文字、Logo、游戏UI/);
});

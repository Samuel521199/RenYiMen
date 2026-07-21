import { appendFile, mkdir, stat } from "fs/promises";
import path from "path";
import { onePromptVideoLogDir, errorForLog } from "./logger";
import type {
  AnchorStateTimeline,
  NarrativeEvent,
  OnePromptVideoPlan,
  PlanVideoProjectInput,
  SegmentRenderDescription,
  VideoPlanKeyframe,
  VideoPlanSegment,
} from "./types";

type StageLogLevel = "info" | "warn" | "error";

type StageName =
  | "project"
  | "script"
  | "keyframes"
  | "micro_shots"
  | "clips"
  | "final";

const STAGE_FILES: Record<StageName, string> = {
  project: "00-project.md",
  script: "01-script-breakdown.md",
  keyframes: "02-keyframes.md",
  micro_shots: "03-micro-shots.md",
  clips: "04-clips.md",
  final: "05-final-compose.md",
};

const STAGE_TITLES: Record<StageName, string> = {
  project: "项目概览",
  script: "剧情拆解",
  keyframes: "关键帧生成",
  micro_shots: "内部子分镜参考图",
  clips: "分镜视频生成",
  final: "最终成片生成",
};

const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?key|secret|authorization|token|password|signature)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function appendProjectStageLog(params: {
  projectId: string;
  title?: string | null;
  stage: StageName;
  event: string;
  level?: StageLogLevel;
  summary?: string;
  lines?: string[];
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const dir = await ensureProjectLogDir(params.projectId);
    const filePath = path.join(dir, STAGE_FILES[params.stage]);
    const isNew = !(await exists(filePath));
    const sanitizedData = sanitizeForHumanLog(params.data ?? {});
    const safeData: Record<string, unknown> = isRecord(sanitizedData) ? sanitizedData : {};
    const chunks: string[] = [];
    if (isNew) {
      chunks.push(`# ${STAGE_TITLES[params.stage]}`);
      chunks.push("");
      chunks.push(`项目 ID：\`${params.projectId}\``);
      if (params.title) chunks.push(`项目标题：${params.title}`);
      chunks.push("");
    }
    chunks.push(`## ${formatLocalTime()} · ${params.event}`);
    chunks.push("");
    if (params.level && params.level !== "info") chunks.push(`级别：${params.level}`);
    if (params.summary) chunks.push(params.summary);
    if (params.lines?.length) {
      chunks.push("");
      chunks.push(...params.lines.map((line) => `- ${line}`));
    }
    if (Object.keys(safeData).length) {
      chunks.push("");
      chunks.push("```json");
      chunks.push(JSON.stringify(safeData, null, 2));
      chunks.push("```");
    }
    chunks.push("");
    await appendFile(filePath, `${chunks.join("\n")}\n`, "utf8");
    await appendProjectEvent(params.projectId, {
      ts: new Date().toISOString(),
      level: params.level ?? "info",
      stage: params.stage,
      event: params.event,
      summary: params.summary,
      data: safeData,
    });
  } catch (error) {
    console.error("[one-prompt-video-stage-log] write failed", error);
  }
}

export async function writeProjectOverviewLog(params: {
  projectId: string;
  title?: string | null;
  userId?: string;
  prompt?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  stylePreset?: string | null;
  referenceImageCount?: number;
  status?: string;
}): Promise<void> {
  await appendProjectStageLog({
    projectId: params.projectId,
    title: params.title,
    stage: "project",
    event: "项目创建/更新",
    summary: "记录这个一句话成片项目的基础信息，后续每个阶段会写入同一项目文件夹。",
    lines: [
      params.prompt ? `用户原始需求：${params.prompt}` : "",
      params.durationSeconds ? `目标时长：${params.durationSeconds}s` : "",
      params.aspectRatio ? `画幅：${params.aspectRatio}` : "",
      params.stylePreset ? `风格预设：${params.stylePreset}` : "",
      `参考图数量：${params.referenceImageCount ?? 0}`,
      params.status ? `当前状态：${params.status}` : "",
    ].filter(Boolean),
    data: params,
  });
}

export async function writeScriptBreakdownLog(params: {
  projectId: string;
  userId?: string;
  input: PlanVideoProjectInput;
  plan: OnePromptVideoPlan;
}): Promise<void> {
  const { input, plan } = params;
  await appendProjectStageLog({
    projectId: params.projectId,
    title: plan.title,
    stage: "script",
    event: "剧情拆解完成",
    summary: "大模型已经把用户的一句话需求拆成可审核、可生成、可回退的成片结构。这里按人能读懂的方式解释它的判断逻辑和结果。",
    lines: [
      `用户需求：${input.userPrompt}`,
      `成片目标：${plan.title}。${plan.logline || "暂无一句话简介"}`,
      `时长和画幅：${plan.durationSeconds}s，${plan.aspectRatio}`,
      `分段原则：镜头数量不是固定值，而是根据叙事节拍、场景/动作变化、镜头是否能一镜到底自然完成来决定。`,
      `首尾帧原则：边界关键帧数量应等于分镜片段数量 + 1；每个分镜片段使用前后两张边界帧作为首尾状态。`,
      `连续性原则：人物、产品、场景、色调等需要稳定的元素会先形成一致性锚点；后续图片和视频生成都会引用这些锚点，减少漂移。`,
      `声音判断：系统会先判断是否需要旁白、对白或环境声，再把对应语言、语气和台词写入音频规划，供最终合成使用。`,
      ...projectIntentLines(plan),
      ...styleLines(plan),
      ...audioLines(plan),
    ],
    data: {
      projectId: params.projectId,
      userId: params.userId,
      title: plan.title,
      logline: plan.logline,
      durationSeconds: plan.durationSeconds,
      aspectRatio: plan.aspectRatio,
      segmentCount: plan.segments.length,
      keyframeCount: plan.keyframes.length,
      consistencyReferenceCount: plan.consistencyReferences?.filter((item) => item.needed).length ?? 0,
      plannerWarnings: plan.plannerWarnings ?? [],
    },
  });

  await appendProjectStageLog({
    projectId: params.projectId,
    title: plan.title,
    stage: "script",
    event: "一致性锚点规划",
    summary: "这些是系统认为必须保持稳定的主体。需要参考图的锚点会先生成固定参考图，再参与后续关键帧和视频片段生成。",
    lines: consistencyAnchorLines(plan),
  });

  await appendProjectStageLog({
    projectId: params.projectId,
    title: plan.title,
    stage: "script",
    event: "叙事事件和状态变化",
    summary: "这一段解释故事如何从开始走到结束，以及人物/道具/场景状态在各段之间如何变化。",
    lines: [
      ...narrativeEventLines(plan.narrativeEvents ?? []),
      ...anchorStateLines(plan.anchorStateTimeline ?? []),
    ],
  });

  await appendProjectStageLog({
    projectId: params.projectId,
    title: plan.title,
    stage: "script",
    event: "时间线、边界关键帧和视频片段",
    summary: "这里是最重要的生成结构：关键帧负责片段首尾状态，视频片段负责从前一张关键帧自然运动到后一张关键帧。",
    lines: [
      ...timelineLines(plan),
      ...keyframeLines(plan.keyframes),
      ...segmentLines(plan.segments, plan.segmentRenderDescriptions ?? []),
    ],
  });

  await appendProjectStageLog({
    projectId: params.projectId,
    title: plan.title,
    stage: "script",
    event: "生成 Prompt 规划",
    summary: "图片 Prompt 描述静止画面状态；视频 Prompt 描述从首帧到尾帧之间的动作、镜头和一镜到底约束。",
    lines: promptPlanLines(plan),
  });
}

export async function writeStageErrorLog(params: {
  projectId: string;
  title?: string | null;
  stage: StageName;
  event: string;
  error: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  await appendProjectStageLog({
    projectId: params.projectId,
    title: params.title,
    stage: params.stage,
    event: params.event,
    level: "error",
    summary: "这一阶段失败了。下面是可读原因和机器上下文，优先看 message，再看阶段上下文。",
    data: {
      ...params.context,
      error: errorForLog(params.error),
    },
  });
}

async function ensureProjectLogDir(projectId: string): Promise<string> {
  const dir = path.join(onePromptVideoLogDir(), "projects", sanitizePathSegment(projectId));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function appendProjectEvent(projectId: string, event: Record<string, unknown>): Promise<void> {
  const dir = await ensureProjectLogDir(projectId);
  await appendFile(path.join(dir, "events.jsonl"), `${JSON.stringify(sanitizeForHumanLog(event))}\n`, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function projectIntentLines(plan: OnePromptVideoPlan): string[] {
  const intent = plan.planningManifest?.projectIntent;
  const strategy = plan.planningManifest?.storyStrategy;
  const risks = plan.planningManifest?.risks ?? [];
  return [
    intent?.primaryGoalZh ? `视频目标：${intent.primaryGoalZh}` : "",
    intent?.targetViewerZh ? `目标观众：${intent.targetViewerZh}` : "",
    strategy?.narrativeArcZh ? `叙事弧线：${strategy.narrativeArcZh}` : "",
    strategy?.recommendedSegmentDensity ? `镜头密度判断：${strategy.recommendedSegmentDensity}` : "",
    risks.length ? `主要风险：${risks.map((risk) => `${risk.descriptionZh || risk.type || "未命名风险"}${risk.mitigationZh ? `，处理方式：${risk.mitigationZh}` : ""}`).join("；")}` : "",
  ].filter(Boolean);
}

function styleLines(plan: OnePromptVideoPlan): string[] {
  const style = plan.styleBible;
  return [
    style?.visualStyle ? `视觉风格：${style.visualStyle}` : "",
    style?.colorPalette ? `色彩范围：${style.colorPalette}` : "",
    style?.colorToneLock ? `色调一致性：${style.colorToneLock}` : "",
    style?.lightingToneLock ? `光线一致性：${style.lightingToneLock}` : "",
    style?.characterLock ? `人物一致性：${style.characterLock}` : "",
    style?.productLock ? `产品/道具一致性：${style.productLock}` : "",
  ].filter(Boolean);
}

function audioLines(plan: OnePromptVideoPlan): string[] {
  const audio = plan.audioBible ?? {};
  const subtitlePolicy = plan.planningManifest?.subtitlePolicy;
  return [
    `字幕判断：${subtitlePolicy?.needed ? "需要" : "不强制"}${subtitlePolicy?.reasonZh ? `，原因：${subtitlePolicy.reasonZh}` : ""}`,
    audio.mode ? `声音模式：${String(audio.mode)}` : "",
    typeof audio.needsVoiceover === "boolean" ? `旁白：${audio.needsVoiceover ? "需要" : "不需要"}` : "",
    typeof audio.needsDialogue === "boolean" ? `人物对白：${audio.needsDialogue ? "需要" : "不需要"}` : "",
    audio.language ? `语言：${String(audio.language)}` : "",
    Array.isArray(audio.linesZh) && audio.linesZh.length ? `中文台词/旁白：${audio.linesZh.join(" / ")}` : "",
    Array.isArray(audio.lines) && audio.lines.length ? `台词/旁白：${audio.lines.join(" / ")}` : "",
  ].filter(Boolean);
}

function consistencyAnchorLines(plan: OnePromptVideoPlan): string[] {
  const anchors = plan.consistencyManifest?.anchors ?? plan.planningManifest?.consistencyManifest?.anchors ?? [];
  const references = plan.consistencyReferences?.filter((item) => item.needed) ?? [];
  const lines = anchors.map((anchor) => {
    const name = anchor.displayNameZh || anchor.displayNameEn || anchor.id;
    return `${name}：${anchor.descriptionZh || anchor.descriptionEn || "无描述"}；稳定级别=${anchor.referenceStrength || "medium"}；${anchor.needsReferenceImage ? "需要先生成一致性参考图" : "不需要单独参考图"}`;
  });
  if (references.length) {
    lines.push(...references.map((reference) => {
      const label = reference.purposeZh || reference.purpose || `参考图 ${reference.keyframeNo}`;
      return `参考图 ${reference.keyframeNo}（${reference.kind}）：${label}。Prompt：${truncate(reference.imagePromptZh || reference.imagePrompt, 240)}`;
    }));
  }
  return lines.length ? lines : ["本次剧情没有识别到必须单独生成的一致性参考图。"];
}

function narrativeEventLines(events: NarrativeEvent[]): string[] {
  if (!events.length) return ["模型没有返回独立叙事事件列表，已直接使用分镜时间线。"];
  return events.map((event) => {
    const separate = event.mustBecomeSeparateSegment ? "需要独立成段" : "可与相邻动作合并";
    return `${event.eventId}：目标=${event.dramaticGoal}；动作=${event.action}；结果=${event.resultingState}；地点=${event.locationId}；${separate}`;
  });
}

function anchorStateLines(timelines: AnchorStateTimeline[]): string[] {
  if (!timelines.length) return [];
  return timelines.flatMap((timeline) => [
    `状态锚点 ${timeline.anchorId}：`,
    ...timeline.states.map((state) => `  段 ${state.segmentNo}：${state.startState} -> ${state.endState}；位置 ${state.startPosition} -> ${state.endPosition}；可见转变=${state.visibleTransitionPath}`),
  ]);
}

function timelineLines(plan: OnePromptVideoPlan): string[] {
  const blueprint = plan.timelineBlueprint ?? plan.planningManifest?.timelineBlueprint;
  return [
    blueprint ? `模型选择 ${blueprint.segmentCount} 个片段，总时长 ${blueprint.totalDurationSeconds}s；每段建议 ${blueprint.segmentDurationMinSeconds}-${blueprint.segmentDurationMaxSeconds}s。` : "",
    blueprint?.splitStrategyZh ? `切段策略：${blueprint.splitStrategyZh}` : "",
    ...((blueprint?.segments ?? []).map((segment) => `蓝图段 ${segment.segmentNo}：${segment.startTimeSeconds}-${segment.endTimeSeconds}s，${segment.purposeZh || segment.beatRole || "未写目的"}；切段原因：${segment.splitReasonZh || "未写"}`)),
  ].filter(Boolean);
}

function keyframeLines(keyframes: VideoPlanKeyframe[]): string[] {
  if (!keyframes.length) return ["没有关键帧。"];
  return [
    "边界关键帧：",
    ...keyframes.map((keyframe) => {
      const role = keyframe.frameRole || "boundary";
      return `  KF${keyframe.keyframeNo} · ${keyframe.timeSeconds}s · ${role}：${keyframe.purposeZh || keyframe.purpose}；画面状态=${keyframe.characterState || keyframe.productState || keyframe.scene}；图片 Prompt=${truncate(keyframe.imagePromptZh || keyframe.imagePrompt, 260)}`;
    }),
  ];
}

function segmentLines(segments: VideoPlanSegment[], descriptions: SegmentRenderDescription[]): string[] {
  if (!segments.length) return ["没有视频片段。"];
  const descMap = new Map(descriptions.map((item) => [item.segmentNo, item]));
  return [
    "分镜视频片段：",
    ...segments.flatMap((segment) => {
      const desc = descMap.get(segment.segmentNo);
      const warnings = desc?.warnings?.length ? `；风险提示=${desc.warnings.join(" / ")}` : "";
      return [
        `  镜头 ${segment.segmentNo}：KF${segment.startKeyframeNo} -> KF${segment.endKeyframeNo}，${segment.startTimeSeconds}-${segment.endTimeSeconds}s，共 ${segment.durationSeconds}s，边界=${segment.boundaryMode || "continuous"}${warnings}`,
        `    镜头目的：${segment.purposeZh || segment.purpose}`,
        `    运动说明：${segment.motion}`,
        `    运镜：${segment.camera}`,
        `    视频 Prompt：${truncate(segment.videoPromptZh || segment.videoPrompt, 300)}`,
        ...(segment.microShots?.length ? [`    内部子分镜：${segment.microShots.map((shot) => `#${shot.microShotNo}@${shot.localTimeSeconds}s ${shot.purposeZh || shot.purpose}`).join("；")}`] : []),
      ];
    }),
  ];
}

function promptPlanLines(plan: OnePromptVideoPlan): string[] {
  const promptDetail = plan.promptDetailPlan;
  const lines: string[] = [];
  if (promptDetail?.generationNotes?.length) {
    lines.push(`生成注意事项：${promptDetail.generationNotes.join("；")}`);
  }
  if (promptDetail?.keyframePrompts?.length) {
    lines.push(...promptDetail.keyframePrompts.map((item) => `关键帧 KF${item.keyframeNo} 图片 Prompt：${truncate(item.imagePromptZh || item.imagePromptEn || "", 260)}`));
  }
  if (promptDetail?.segmentVideoPrompts?.length) {
    lines.push(...promptDetail.segmentVideoPrompts.map((item) => `镜头 ${item.segmentNo} 视频 Prompt：${truncate(item.videoPromptZh || item.videoPromptEn || "", 260)}`));
  }
  if (promptDetail?.microShotImagePrompts?.length) {
    lines.push(...promptDetail.microShotImagePrompts.map((item) => `镜头 ${item.segmentNo} 子分镜 ${item.microShotNo} 参考图 Prompt：${truncate(item.imagePromptZh || item.imagePromptEn || "", 220)}`));
  }
  return lines.length ? lines : ["模型没有单独返回 Prompt 明细，系统已从关键帧和片段结构中编译生成 Prompt。"];
}

function formatLocalTime(): string {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120) || "unknown-project";
}

function sanitizeForHumanLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") return redactSecretLikeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeForHumanLog(item, depth + 1));
  if (typeof value !== "object") return String(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeForHumanLog(item, depth + 1);
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

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

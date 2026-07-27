import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_LOG_DIR = process.platform === "win32" ? "D:\\zzz\\v debug" : "/tmp/one-prompt-video-debug";
const LOG_FILE_NAME = "one-prompt-video.log";
const READABLE_LOG_FILE_NAME = "一句话成片-耗时日志.log";
const PROCESS_STARTED_AT_MS = Date.now();
const MAX_PENDING_SPANS = 5000;
const MAX_SPAN_AGE_MS = 6 * 60 * 60 * 1000;

type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?key|secret|authorization|token|password|signature)/i;
const START_EVENT_SUFFIXES = [".start", ".request", ".prepare", ".queued"] as const;
const END_EVENT_SUFFIXES = [".success", ".response", ".done", ".ready", ".completed", ".error", ".failed"] as const;

type PendingSpan = {
  id: number;
  startEvent: string;
  eventStem: string;
  startedAtMs: number;
  correlationKeys: string[];
};

const loggerRuntime = globalThis as typeof globalThis & {
  onePromptVideoPendingSpans?: Map<string, PendingSpan[]>;
  onePromptVideoLogSequence?: number;
  onePromptVideoSpanSequence?: number;
};
const logContextStorage = new AsyncLocalStorage<Record<string, unknown>>();
const pendingSpans = loggerRuntime.onePromptVideoPendingSpans ?? new Map<string, PendingSpan[]>();
loggerRuntime.onePromptVideoPendingSpans = pendingSpans;

function logDir(): string {
  return process.env.ONE_PROMPT_VIDEO_LOG_DIR?.trim() || DEFAULT_LOG_DIR;
}

export function onePromptVideoLogDir(): string {
  return logDir();
}

export function onePromptVideoLogPath(): string {
  return path.join(logDir(), LOG_FILE_NAME);
}

export function onePromptVideoReadableLogPath(): string {
  return path.join(logDir(), READABLE_LOG_FILE_NAME);
}

export async function logOnePromptVideo(
  event: string,
  data: Record<string, unknown> = {},
  level: LogLevel = "info",
): Promise<void> {
  try {
    const contextualData: Record<string, unknown> = {
      ...(logContextStorage.getStore() ?? {}),
      ...data,
    };
    await mkdir(logDir(), { recursive: true });
    const nowMs = Date.now();
    const timing = resolveEventTiming(event, contextualData, nowMs);
    loggerRuntime.onePromptVideoLogSequence = (loggerRuntime.onePromptVideoLogSequence ?? 0) + 1;
    const now = new Date();
    const enrichedData: Record<string, unknown> = {
      ...contextualData,
      ...(timing && contextualData.durationMs === undefined ? timing : {}),
    };
    const payload = {
      ts: now.toISOString(),
      level,
      event,
      sequence: loggerRuntime.onePromptVideoLogSequence,
      processUptimeMs: nowMs - PROCESS_STARTED_AT_MS,
      data: sanitizeForLog(enrichedData),
    };
    await appendFile(onePromptVideoLogPath(), `${JSON.stringify(payload)}\n`, "utf8");
    const shouldWriteReadable = shouldWriteReadableLog(event, enrichedData, level);
    const readableLine = shouldWriteReadable
      ? formatReadableLogLine(now, event, enrichedData, level)
      : "";
    if (readableLine) {
      await appendFile(onePromptVideoReadableLogPath(), `${readableLine}\n`, "utf8");
    }
    if (readableLine && typeof enrichedData.projectId === "string" && enrichedData.projectId.trim()) {
      const projectDir = path.join(logDir(), "projects", sanitizePathSegment(enrichedData.projectId));
      await mkdir(projectDir, { recursive: true });
      await appendFile(path.join(projectDir, "耗时日志.log"), `${readableLine}\n`, "utf8");
    }
  } catch (error) {
    console.error("[one-prompt-video-log] write failed", error);
  }
}

export function withOnePromptVideoLogContext<T>(
  context: Record<string, unknown>,
  operation: () => T,
): T {
  return logContextStorage.run({
    ...(logContextStorage.getStore() ?? {}),
    ...context,
  }, operation);
}

function formatReadableLogLine(
  now: Date,
  event: string,
  data: Record<string, unknown>,
  level: LogLevel,
): string {
  if (event.startsWith("production.step.")) {
    return formatProductionStepLine(now, event, data, level);
  }
  const target = atomicTargetLabel(data);
  const parts = [
    `[${formatChinaTime(now)}]`,
    `【模块：${legacyModuleNameZh(event, data)}】`,
    target ? `【对象：${target}】` : `【${projectLabel(data)}】`,
    `【${eventStateLabel(event, data, level)}】${humanEventLabel(event)}`,
  ];
  const durationMs = typeof data.durationMs === "number" && Number.isFinite(data.durationMs)
    ? data.durationMs
    : undefined;
  if (durationMs !== undefined) parts.push(`耗时 ${formatDuration(durationMs)}`);

  const details = readableDetails(data);
  if (details.length) parts.push(details.join("，"));
  return parts.filter(Boolean).join(" | ");
}

function legacyModuleNameZh(event: string, data: Record<string, unknown>): string {
  const explicit = firstText(data, ["moduleNameZh", "moduleName", "module"]);
  if (explicit) return explicit;
  if (event.startsWith("aliyun.storyboard.") || event.startsWith("story_") || event.startsWith("single_take_")) return "脚本与分镜规划";
  if (event.startsWith("reference_selector.") || event.startsWith("prompt_compiler.")) return "图片生成决策";
  if (event.startsWith("generation_quality.image")) return "图片质量检查";
  if (event.startsWith("generation_quality.video")) return "视频质量检查";
  if (event.startsWith("generation_candidate.video") || event.startsWith("clip.")) return "视频片段生成";
  if (event.startsWith("generation_candidate.image") || event.startsWith("image.")) return "图片生成";
  if (event.startsWith("micro_shot.")) return "子分镜生成";
  if (event.startsWith("compose.")) return "最终成片合成";
  if (event.startsWith("dashscope.task.")) return "上游生成服务";
  if (event.startsWith("frontend.")) return "工作台页面";
  if (event.startsWith("project.")) return "项目流程";
  return "其他生产记录";
}

/**
 * The JSON log keeps every polling and synchronization event. The readable
 * ledger intentionally hides routine polling so a producer sees the actual
 * work: prompt preparation, model calls, checks, repairs and deliverables.
 * Slow or failed infrastructure calls are still surfaced.
 */
function shouldWriteReadableLog(
  event: string,
  data: Record<string, unknown>,
  level: LogLevel,
): boolean {
  if (event.startsWith("production.step.")) return true;
  if (level === "error" || level === "warn" || event.endsWith(".error") || event.endsWith(".failed")) return true;
  const durationMs = numberValue(data.durationMs) ?? 0;
  const noisy = event.startsWith("project.sync.")
    || event === "frontend.api.request.completed"
    || event === "image.sync.start"
    || event === "micro_shot.image.sync.start"
    || event === "clip.sync.start"
    || event.startsWith("dashscope.task.query.");
  return !noisy || durationMs >= 10_000;
}

function formatProductionStepLine(
  now: Date,
  event: string,
  data: Record<string, unknown>,
  level: LogLevel,
): string {
  const moduleName = firstText(data, ["moduleNameZh", "moduleName", "module"]) || "未分类功能";
  const stepName = firstText(data, ["stepNameZh", "stepName", "step"]) || humanEventLabel(event);
  const target = atomicTargetLabel(data);
  const state = eventStateLabel(event, data, level);
  const parts = [
    `[${formatChinaTime(now)}]`,
    `【模块：${truncateAtomicLabel(moduleName)}】`,
    target ? `【对象：${target}】` : `【${projectLabel(data)}】`,
    `【${state}】${truncateReadable(stepName)}`,
  ];
  const durationMs = numberValue(data.durationMs);
  if (durationMs !== undefined) parts.push(`耗时 ${formatDuration(durationMs)}`);
  const method = humanExecutionMethod(firstText(data, ["executionMethod", "qualityMethod", "method"]));
  if (method) parts.push(`执行者 ${method}`);
  const model = firstText(data, ["model", "evaluationModel"]);
  if (model) parts.push(`模型 ${truncateReadable(model)}`);
  const result = firstText(data, ["resultZh", "result", "outcome"]);
  if (result) parts.push(`结果 ${truncateReadable(result)}`);
  const repairMode = firstText(data, ["repairMode"]);
  if (repairMode) parts.push(`返修方式 ${humanRepairMode(repairMode)}`);
  const waitingMs = numberValue(data.waitingAfterQcMs);
  if (waitingMs !== undefined) parts.push(`质检后等待 ${formatDuration(waitingMs)}`);
  if (typeof data.passed === "boolean") parts.push(`质检 ${data.passed ? "通过" : "打回"}`);
  const attempt = numberValue(data.attempt);
  if (attempt !== undefined && numberValue(data.candidateNo) === undefined) parts.push(`第 ${attempt} 轮`);
  const message = firstText(data, ["errorMessage", "message"]);
  if (message) parts.push(`${state === "失败" ? "原因" : "说明"} ${truncateReadable(message)}`);
  return parts.filter(Boolean).join(" | ");
}

function humanExecutionMethod(value: string): string {
  const labels: Record<string, string> = {
    program: "程序",
    deterministic_program: "程序硬检查",
    model: "大模型",
    vision_model: "视觉大模型",
    image_model: "图片生成模型",
    video_model: "视频生成模型",
    human: "人工",
  };
  return labels[value] ?? value;
}

function humanRepairMode(value: string): string {
  const labels: Record<string, string> = {
    local_edit: "局部修复",
    guided_regenerate: "带问题说明重新生成",
    full_regenerate: "整张重新生成",
    reference_reselect: "重选参考图",
    contract_recompile: "重写提示词合同",
    storyboard_replan: "返回脚本拆解重做",
    reevaluate_only: "仅重新质检",
    manual_review: "转人工复核",
  };
  return labels[value] ?? value;
}

function atomicTargetLabel(data: Record<string, unknown>): string {
  const atomicFunction = firstText(data, ["atomicFunction"]);
  const explicit = firstText(data, ["assetLabel", "assetNameZh", "assetName"]);
  const artifactId = firstText(data, ["artifactId", "assetId"]);
  const category = humanAssetCategory(firstText(data, ["assetCategory", "generationKind", "kind"]));
  const view = humanAssetView(firstText(data, ["assetView", "view"]));
  const parsed = parseArtifactId(artifactId);
  if (atomicFunction && !explicit && !artifactId) return `功能 ${truncateAtomicLabel(atomicFunction)}`;
  const target = explicit
    ? `${category || parsed.category || "资产"}「${truncateAtomicLabel(explicit)}」`
    : parsed.label || category;
  const pieces = [
    target,
    view || parsed.view,
    candidateLabel(data),
  ].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : "";
}

function candidateLabel(data: Record<string, unknown>): string {
  const candidateNo = numberValue(data.candidateNo);
  if (candidateNo === undefined) return "";
  const count = numberValue(data.candidateCount);
  const attempt = numberValue(data.attempt);
  const noun = data.generationKind === "segment_video" || data.generationKind === "generated_bridge"
    ? "候选视频"
    : "候选图";
  return `${noun} ${candidateNo}${count ? `/${count}` : ""}${attempt && attempt > 1 ? `（第 ${attempt} 轮）` : ""}`;
}

function parseArtifactId(artifactId: string): { label: string; category: string; view: string } {
  let match = artifactId.match(/^segment:(\d+):micro_shot:(\d+):image$/);
  if (match) return { label: `第 ${match[1]} 段 · 子分镜 ${match[2]}`, category: "子分镜参考图", view: "" };
  match = artifactId.match(/^segment:(\d+):video$/);
  if (match) return { label: `第 ${match[1]} 段`, category: "视频片段", view: "" };
  match = artifactId.match(/^keyframe:(\d+):image$/);
  if (match) return { label: `关键帧 ${match[1]}`, category: "边界关键帧", view: "" };
  match = artifactId.match(/^consistency_reference:(-\d+):image$/);
  if (match) return { label: `资产参考图 ${match[1]}`, category: "一致性资产", view: "" };
  return { label: "", category: "", view: "" };
}

function humanAssetCategory(value: string): string {
  const labels: Record<string, string> = {
    person: "人物资产",
    character: "人物资产",
    product: "产品资产",
    prop: "道具资产",
    scene: "场景资产",
    brand_visual: "品牌视觉资产",
    keyframe_image: "关键帧图片",
    micro_shot_image: "子分镜参考图",
    segment_video: "视频片段",
    generated_bridge: "转场桥接视频",
  };
  return labels[value] ?? "";
}

function humanAssetView(value: string): string {
  const labels: Record<string, string> = {
    front: "正面图",
    side: "侧面图",
    back: "背面图",
    three_quarter: "四分之三视角",
    detail: "细节图",
    hero: "主视觉图",
  };
  return labels[value] ?? (value ? `${value} 视角` : "");
}

function firstText(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return "";
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatChinaTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: process.env.ONE_PROMPT_VIDEO_LOG_TIMEZONE?.trim() || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function projectLabel(data: Record<string, unknown>): string {
  if (typeof data.projectId === "string" && data.projectId) return `项目 ${data.projectId}`;
  if (typeof data.taskId === "string" && data.taskId) return `任务 ${shortId(data.taskId)}`;
  if (typeof data.jobId === "string" && data.jobId) return `任务 ${shortId(data.jobId)}`;
  return "全局";
}

function eventStateLabel(event: string, data: Record<string, unknown>, level: LogLevel): string {
  if (level === "error" || event.endsWith(".error") || event.endsWith(".failed")) return "失败";
  if (level === "warn") return "注意";
  if (event.endsWith(".start") || event.endsWith(".request") || event.endsWith(".prepare")) return "开始";
  if (event.endsWith(".queued")) return "排队";
  if (data.ok === false || data.status === "failed") return "失败";
  if (event.endsWith(".success") || event.endsWith(".done") || event.endsWith(".ready") || event.endsWith(".completed")) return "完成";
  if (event.endsWith(".selected")) return "完成";
  if (data.ok === true && typeof data.durationMs === "number") return "完成";
  if (data.status === "running" || data.status === "pending") return "进行中";
  return "记录";
}

function humanEventLabel(event: string): string {
  const exact: Record<string, string> = {
    "project.create.request": "创建项目",
    "project.create.success": "项目创建完成",
    "project.plan.queued": "剧本规划进入队列",
    "project.plan.start": "开始生成剧本和分镜规划",
    "project.plan.success": "剧本和分镜规划完成",
    "project.sync.start": "同步生成任务状态",
    "project.sync.done": "生成任务状态同步完成",
    "project.resume.start": "恢复项目生成",
    "project.resume.dirty_keyframe": "找到需要重新生成的资产图片",
    "image.batch.submit.start": "批量提交图片生成",
    "image.batch.submit.done": "图片生成任务提交完成",
    "image.sync.start": "查询图片生成进度",
    "image.sync.project.ready": "全部关键帧图片已就绪",
    "micro_shot.image.sync.start": "查询子分镜图片进度",
    "clip.batch.submit.start": "批量提交视频片段生成",
    "clip.batch.submit.done": "视频片段生成任务提交完成",
    "clip.sync.start": "查询视频片段生成进度",
    "clip.sync.project.ready": "全部视频片段已就绪",
    "compose.local.start": "开始合成最终视频",
    "compose.local.success": "最终视频合成完成",
    "frontend.api.request.completed": "工作台页面 API 请求",
    "image.regenerate.start": "重新生成资产图片",
    "image.regenerate.success": "资产图片重新提交完成",
    "reference_selector.output": "选择生成参考图",
    "prompt_compiler.output": "编译本次生成提示词",
    "image.sync.submit.wait_consistency_references": "等待前置一致性资产完成",
    "image.sync.submit.wait_consistency_approval": "等待前置一致性资产审核锁定",
    "generation_candidate.image.submit.start": "提交这张候选图",
    "generation_candidate.image.submit.success": "候选图提交完成",
    "generation_candidate.video.submit.start": "提交这条候选视频",
    "generation_candidate.video.submit.success": "候选视频提交完成",
    "generation_candidate.selected": "采用这份候选结果",
  };
  if (exact[event]) return exact[event];
  if (event.startsWith("aliyun.storyboard.")) {
    const stage = event
      .replace("aliyun.storyboard.", "")
      .replace(/\.(request|response|start|success|error|failed|parsed)$/, "");
    return `剧本规划模型：${humanPlannerStage(stage)}`;
  }
  if (event.startsWith("dashscope.task.submit.")) return "向阿里云提交生成任务";
  if (event.startsWith("dashscope.task.query.")) return "查询阿里云生成任务";
  if (event.startsWith("generation_quality.image_eval")) return "图片质量检查";
  if (event.startsWith("generation_quality.video")) return "视频质量检查";
  if (event.startsWith("generation_quality.")) return "生成结果质量检查";
  if (event.startsWith("image.persist.")) return "图片保存到 OSS";
  if (event.startsWith("compose.local.clip_download.")) return "下载待合成视频片段";
  if (event.startsWith("compose.local.clip_duration_probe.")) return "检测视频片段时长";
  if (event.startsWith("compose.local.clip_audio_probe.")) return "检测视频片段音轨";
  if (event.startsWith("compose.local.ffmpeg_video_compose.")) return "FFmpeg 拼接视频";
  if (event.startsWith("compose.local.composed_duration_probe.")) return "检查成片时长";
  if (event.startsWith("compose.local.audio_postprocess.")) return "处理成片音频";
  if (event.startsWith("compose.local.subtitle_burn.")) return "写入成片字幕";
  if (event.startsWith("compose.local.oss_upload.")) return "上传最终成片到 OSS";
  return event;
}

function humanPlannerStage(stage: string): string {
  if (stage.startsWith("planning_architect")) return "故事架构设计";
  if (stage.startsWith("storyboard_artist")) return "故事板设计";
  if (stage.startsWith("shot_decomposer")) return `镜头拆解${stageSuffix(stage)}`;
  if (stage.startsWith("prompt_detailer")) return `生成提示词细化${stageSuffix(stage)}`;
  if (stage.startsWith("story_contract_repair")) return `故事逻辑修复${stageSuffix(stage)}`;
  if (stage.startsWith("split_repair")) return `镜头拆分修复${stageSuffix(stage)}`;
  if (stage.startsWith("reference_fact_extractor")) return "参考图信息提取";
  return stage.replace(/_/g, " ");
}

function stageSuffix(stage: string): string {
  const segment = stage.match(/_s(\d+)/)?.[1];
  const retry = stage.match(/_r(\d+)/)?.[1];
  return `${segment ? `（第 ${segment} 段）` : ""}${retry ? `（第 ${retry} 次重试）` : ""}`;
}

function readableDetails(data: Record<string, unknown>): string[] {
  const details: string[] = [];
  appendDetail(details, "阶段", humanPlanningStage(data.stage));
  const status = data.status ?? data.upstreamStatus;
  if (typeof status === "number") appendDetail(details, "HTTP", status);
  else appendDetail(details, "状态", humanStatus(status));
  appendDetail(details, "HTTP", data.httpStatus ?? data.statusCode);
  appendDetail(details, "片段", data.segmentNo);
  appendDetail(details, "关键帧", data.keyframeNo);
  appendDetail(details, "子分镜", data.microShotNo);
  appendDetail(details, "尝试轮次", data.attempt);
  appendDetail(details, "下次尝试", data.nextAttempt);
  appendDetail(details, "序号", data.clipIndex);
  appendDetail(details, "数量", data.clipCount ?? data.imageCount ?? data.runningCount);
  appendDetail(details, "模型", data.model);
  appendDetail(details, "任务", shortId(data.taskId ?? data.imageTaskId ?? data.clipTaskId ?? data.jobId));
  appendDetail(details, "接口", data.route);
  appendDetail(details, "方式", data.mode);
  if (typeof data.passed === "boolean") details.push(`质检 ${data.passed ? "通过" : "未通过"}`);
  if (Array.isArray(data.waitingAssets) && data.waitingAssets.length) {
    details.push(`正在等待 ${data.waitingAssets.slice(0, 8).map(String).join("、")}`);
  }
  if (typeof data.errorMessage === "string" && data.errorMessage) {
    const failed = data.status === "failed" || data.ok === false;
    details.push(`${failed ? "原因" : "提示"} ${truncateReadable(data.errorMessage)}`);
  } else if (typeof data.message === "string" && data.message) {
    details.push(`原因 ${truncateReadable(data.message)}`);
  }
  return details;
}

function humanPlanningStage(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const labels: Record<string, string> = {
    queued: "等待规划",
    reference_fact_extractor: "提取参考图事实",
    planning_architect: "设计故事架构与资产",
    storyboard_artist: "设计故事板",
    shot_decomposer: "拆解镜头",
    prompt_detailer: "细化生成提示词",
    story_contract: "检查故事因果关系",
    story_quality_gate: "检查故事质量",
    complete: "脚本拆解完成",
    failed: "脚本拆解失败",
  };
  return labels[value] ?? value;
}

function humanStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const labels: Record<string, string> = {
    DRAFT: "草稿",
    PLANNING: "正在规划剧本",
    PLAN_REVIEW: "等待审核剧本",
    IMAGE_GENERATING: "正在生成图片",
    IMAGE_REVIEW: "等待审核关键帧图片",
    MICRO_SHOT_REVIEW: "等待审核子分镜",
    CLIP_GENERATING: "正在生成视频片段",
    CLIP_REVIEW: "等待审核视频片段",
    COMPOSING: "正在合成最终视频",
    FINAL_REVIEW: "等待审核最终成片",
    DONE: "全部完成",
    FAILED: "失败",
    queued: "排队中",
    pending: "等待中",
    running: "进行中",
    succeeded: "成功",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[value] ?? value;
}

function appendDetail(target: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  target.push(`${label} ${truncateReadable(String(value))}`);
}

function shortId(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function truncateReadable(value: string): string {
  const safe = redactSecretLikeString(value).replace(/\s+/g, " ").trim();
  return safe.length > 160 ? `${safe.slice(0, 157)}...` : safe;
}

function truncateAtomicLabel(value: string): string {
  const safe = truncateReadable(value);
  return safe.length > 56 ? `${safe.slice(0, 53)}...` : safe;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1000).toFixed(1);
  return `${minutes} 分 ${seconds} 秒`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

/**
 * Existing orchestrator events consistently use start/request and
 * success/response/done/error suffixes. Pair them here so every current and
 * future flow gets a duration without requiring bespoke timers at every call
 * site. Explicit durationMs values always win.
 */
function resolveEventTiming(
  event: string,
  data: Record<string, unknown>,
  nowMs: number,
): { durationMs: number; timingSource: "event_pair"; timingStartEvent: string } | undefined {
  prunePendingSpans(nowMs);
  const startSuffix = START_EVENT_SUFFIXES.find((suffix) => event.endsWith(suffix));
  if (startSuffix) {
    const eventStem = event.slice(0, -startSuffix.length);
    const span: PendingSpan = {
      id: (loggerRuntime.onePromptVideoSpanSequence = (loggerRuntime.onePromptVideoSpanSequence ?? 0) + 1),
      startEvent: event,
      eventStem,
      startedAtMs: nowMs,
      correlationKeys: correlationKeys(eventStem, data),
    };
    for (const key of span.correlationKeys) {
      const queue = pendingSpans.get(key) ?? [];
      queue.push(span);
      pendingSpans.set(key, queue);
    }
    return undefined;
  }

  const endSuffix = END_EVENT_SUFFIXES.find((suffix) => event.endsWith(suffix));
  if (!endSuffix) return undefined;
  const eventStem = event.slice(0, -endSuffix.length);
  for (const key of correlationKeys(eventStem, data)) {
    const queue = pendingSpans.get(key);
    const span = queue?.find((candidate) => candidate.eventStem === eventStem);
    if (!span) continue;
    removePendingSpan(span);
    return {
      durationMs: Math.max(0, nowMs - span.startedAtMs),
      timingSource: "event_pair",
      timingStartEvent: span.startEvent,
    };
  }
  return undefined;
}

function correlationKeys(eventStem: string, data: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const identifiers = [
    "traceId",
    "taskId",
    "jobId",
    "candidateId",
    "artifactId",
    "keyframeId",
    "shotId",
    "segmentId",
    "projectId",
    "userId",
  ] as const;
  for (const name of identifiers) {
    const value = data[name];
    if (typeof value === "string" || typeof value === "number") {
      keys.push(`${eventStem}|${name}:${String(value)}`);
    }
  }
  const label = typeof data.label === "string" ? data.label : "";
  const requestPath = typeof data.path === "string" ? data.path : "";
  if (label || requestPath) keys.push(`${eventStem}|call:${label}|${requestPath}`);
  keys.push(`${eventStem}|uncorrelated`);
  return keys;
}

function removePendingSpan(span: PendingSpan): void {
  for (const key of span.correlationKeys) {
    const queue = pendingSpans.get(key);
    if (!queue) continue;
    const next = queue.filter((candidate) => candidate.id !== span.id);
    if (next.length) pendingSpans.set(key, next);
    else pendingSpans.delete(key);
  }
}

function prunePendingSpans(nowMs: number): void {
  if (pendingSpans.size < MAX_PENDING_SPANS) {
    let hasExpired = false;
    for (const queue of pendingSpans.values()) {
      if (queue.some((span) => nowMs - span.startedAtMs > MAX_SPAN_AGE_MS)) {
        hasExpired = true;
        break;
      }
    }
    if (!hasExpired) return;
  }
  const seen = new Set<number>();
  for (const queue of pendingSpans.values()) {
    for (const span of queue) {
      if (seen.has(span.id)) continue;
      seen.add(span.id);
      if (nowMs - span.startedAtMs > MAX_SPAN_AGE_MS || seen.size > MAX_PENDING_SPANS) {
        removePendingSpan(span);
      }
    }
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

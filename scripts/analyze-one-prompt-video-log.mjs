import { readFile } from "node:fs/promises";

const defaultPath = process.platform === "win32"
  ? "D:\\zzz\\v debug\\one-prompt-video.log"
  : "/tmp/one-prompt-video-debug/one-prompt-video.log";
const filePath = process.argv[2]
  || (process.env.ONE_PROMPT_VIDEO_LOG_DIR
    ? `${process.env.ONE_PROMPT_VIDEO_LOG_DIR}/one-prompt-video.log`
    : defaultPath);
const projectFilter = process.argv[3];

const content = await readFile(filePath, "utf8");
const allRows = content
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
const rows = projectFilter ? relatedProjectRows(allRows, projectFilter) : allRows;

const timed = rows.filter((row) => Number.isFinite(row?.data?.durationMs));
const groups = new Map();
for (const row of timed) {
  const values = groups.get(row.event) || [];
  values.push(Number(row.data.durationMs));
  groups.set(row.event, values);
}

const summary = [...groups.entries()]
  .map(([event, values]) => ({
    event,
    count: values.length,
    totalMs: values.reduce((sum, value) => sum + value, 0),
    avgMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  }))
  .sort((a, b) => b.totalMs - a.totalMs);

console.log("");
console.log("一句话成片耗时分析");
console.log("=".repeat(96));
console.log(`日志文件：${filePath}`);
console.log(`分析范围：${projectFilter ? `项目 ${projectFilter}` : "全部项目"}`);
console.log(`时间范围：${displayTime(rows[0]?.ts)} 至 ${displayTime(rows.at(-1)?.ts)}`);
console.log(`日志事件：${rows.length} 条，其中 ${timed.length} 条包含明确耗时`);
console.log("");
console.log("最耗时的步骤（按累计耗时排序）");
console.log("-".repeat(96));
console.log(
  [
    fixed("排名", 6),
    fixed("步骤", 36),
    fixed("次数", 8),
    fixed("平均", 12),
    fixed("P50", 12),
    fixed("P95", 12),
    fixed("最慢", 12),
    "累计",
  ].join(""),
);
for (const [index, item] of summary.slice(0, 30).entries()) {
  console.log(
    [
      fixed(String(index + 1), 6),
      fixed(humanEvent(item.event), 36),
      fixed(String(item.count), 8),
      fixed(formatDuration(item.avgMs), 12),
      fixed(formatDuration(item.p50Ms), 12),
      fixed(formatDuration(item.p95Ms), 12),
      fixed(formatDuration(item.maxMs), 12),
      formatDuration(item.totalMs),
    ].join(""),
  );
}
console.log("");
if (summary.length) {
  const top = summary[0];
  console.log(`初步结论：累计耗时最高的是“${humanEvent(top.event)}”，共执行 ${top.count} 次，累计 ${formatDuration(top.totalMs)}。`);
  if (top.count > 1) {
    console.log(`排查建议：先确认这个步骤为什么重复执行，以及单次最慢 ${formatDuration(top.maxMs)} 是否来自上游等待或重试。`);
  }
} else {
  console.log("当前范围内还没有可统计的耗时数据，请运行一次完整生成流程后再分析。");
}
console.log("");

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function relatedProjectRows(rows, projectId) {
  const identityKeys = ["taskId", "jobId", "candidateId", "artifactId", "keyframeId", "shotId", "segmentId"];
  const identities = new Set([`projectId:${projectId}`]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const data = row?.data;
      if (!data || typeof data !== "object") continue;
      const rowIdentities = [
        typeof data.projectId === "string" ? `projectId:${data.projectId}` : null,
        ...identityKeys.map((key) =>
          typeof data[key] === "string" || typeof data[key] === "number"
            ? `${key}:${data[key]}`
            : null),
      ].filter(Boolean);
      if (!rowIdentities.some((identity) => identities.has(identity))) continue;
      for (const identity of rowIdentities) {
        if (!identities.has(identity)) {
          identities.add(identity);
          changed = true;
        }
      }
    }
  }
  return rows.filter((row) => {
    const data = row?.data;
    if (!data || typeof data !== "object") return false;
    if (data.projectId === projectId) return true;
    return identityKeys.some((key) => identities.has(`${key}:${data[key]}`));
  });
}

function humanEvent(event) {
  const exact = {
    "frontend.api.request.completed": "工作台页面 API 请求",
    "project.sync.done": "同步生成状态",
    "project.plan.success": "剧本和分镜规划",
    "image.batch.submit.done": "提交图片生成任务",
    "clip.batch.submit.done": "提交视频生成任务",
    "compose.local.success": "最终视频合成",
    "compose.local.clip_download.done": "下载待合成视频片段",
    "compose.local.clip_duration_probe.done": "检测视频片段时长",
    "compose.local.clip_audio_probe.done": "检测视频片段音轨",
    "compose.local.ffmpeg_video_compose.done": "FFmpeg 拼接视频",
    "compose.local.composed_duration_probe.done": "检查成片时长",
    "compose.local.audio_postprocess.done": "成片音频处理",
    "compose.local.subtitle_burn.done": "写入成片字幕",
    "compose.local.oss_upload.done": "上传最终成片",
    "generation_quality.image_eval_completed": "图片质量检查",
    "generation_quality.image_eval_failed": "图片质量检查失败",
  };
  if (exact[event]) return exact[event];
  if (event.includes("planning_architect")) return "故事架构设计";
  if (event.includes("storyboard_artist")) return "故事板设计";
  if (event.includes("shot_decomposer")) return `镜头拆解${segmentLabel(event)}`;
  if (event.includes("prompt_detailer")) return `生成提示词细化${segmentLabel(event)}`;
  if (event.includes("story_contract_repair")) return "故事逻辑修复";
  if (event.includes("split_repair")) return `镜头拆分修复${segmentLabel(event)}`;
  if (event.includes("reference_fact_extractor")) return "参考图信息提取";
  if (event.startsWith("dashscope.task.submit")) return "提交阿里云生成任务";
  if (event.startsWith("dashscope.task.query")) return "查询阿里云任务状态";
  if (event.startsWith("generation_quality.image")) return "图片质量检查";
  if (event.startsWith("generation_quality.video")) return "视频质量检查";
  return event;
}

function segmentLabel(event) {
  const segment = event.match(/_s(\d+)/)?.[1];
  return segment ? `（第 ${segment} 段）` : "";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}秒`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}分${((ms % 60_000) / 1000).toFixed(1)}秒`;
}

function displayTime(value) {
  if (!value) return "无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function fixed(value, width) {
  const chars = [...String(value)];
  const visualWidth = chars.reduce((sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? 1 : 2), 0);
  if (visualWidth >= width) {
    let result = "";
    let used = 0;
    for (const char of chars) {
      const size = /[\u0000-\u00ff]/.test(char) ? 1 : 2;
      if (used + size > width - 2) break;
      result += char;
      used += size;
    }
    return `${result}…${" ".repeat(Math.max(0, width - used - 2))}`;
  }
  return `${value}${" ".repeat(width - visualWidth)}`;
}

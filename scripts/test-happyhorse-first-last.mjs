#!/usr/bin/env node

/**
 * HappyHorse 1.1 R2V 首尾帧实验工具。
 *
 * 启动：
 *   npm run test:happyhorse-first-last
 *
 * 浏览器：
 *   http://127.0.0.1:4317
 *
 * 说明：
 * - 使用项目当前生产线路相同的 happyhorse-1.1-r2v。
 * - 首帧、尾帧均以有序 reference_image 发送；HappyHorse 并没有原生
 *   last_frame 硬约束，本工具用于验证它能否在 Prompt 引导下接近目标尾帧。
 * - 图片先上传到项目已经配置的 OSS，DashScope API Key 不会发送给浏览器。
 */

import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

const HOST = process.env.HAPPYHORSE_TEST_HOST?.trim() || "127.0.0.1";
const PORT = parseInteger(process.env.HAPPYHORSE_TEST_PORT, 4317, 1, 65535);
const MODEL = "happyhorse-1.1-r2v";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const VIDEO_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "SUCCESS", "COMPLETED", "FAILED", "ERROR", "CANCELED"]);

function parseInteger(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function requireEnvironment() {
  const required = {
    apiKey:
      process.env.DASHSCOPE_API_KEY?.trim()
      || process.env.BAILIAN_API_KEY?.trim()
      || process.env.ALIBABA_CLOUD_API_KEY?.trim(),
    region: process.env.OSS_REGION?.trim(),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.OSS_SECRET_ACCESS_KEY?.trim(),
    bucket: process.env.OSS_BUCKET_NAME?.trim(),
    publicDomain:
      process.env.OSS_MEDIA_PUBLIC_DOMAIN?.trim()
      || process.env.OSS_PUBLIC_DOMAIN?.trim(),
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`缺少环境配置：${missing.join(", ")}`);
  }
  return {
    ...required,
    baseUrl: (process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    endpoint: process.env.OSS_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.OSS_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
  };
}

const config = requireEnvironment();
const s3 = new S3Client({
  region: config.region,
  ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  forcePathStyle: config.forcePathStyle,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function textResponse(res, status, contentType, body) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("上传内容超过 60MB 限制");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求 JSON 格式无效");
  }
}

function extensionForContentType(contentType) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  return ".jpg";
}

function decodeImage(input, label) {
  if (!input || typeof input !== "object") throw new Error(`请选择${label}`);
  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error(`${label}格式无效，仅支持 JPG、PNG、WebP、GIF`);
  const contentType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const body = Buffer.from(match[2], "base64");
  if (!body.length) throw new Error(`${label}为空`);
  if (body.length > MAX_IMAGE_BYTES) throw new Error(`${label}超过 20MB`);
  return { body, contentType };
}

function publicObjectUrl(key) {
  const base = config.publicDomain.replace(/\/+$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encoded}`;
}

async function uploadImage(image, role) {
  const date = new Date().toISOString().slice(0, 10);
  const key = [
    "happyhorse-first-last-tests",
    date,
    `${Date.now()}-${role}-${crypto.randomUUID()}${extensionForContentType(image.contentType)}`,
  ].join("/");
  await s3.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: image.body,
    ContentLength: image.body.length,
    ContentType: image.contentType,
    CacheControl: "public, max-age=31536000, immutable",
    ContentDisposition: "inline",
  }));
  return publicObjectUrl(key);
}

function buildPrompt(script) {
  return [
    "HAPPYHORSE FIRST/LAST FRAME CONTROL EXPERIMENT",
    "",
    "IMAGE ROLE MAP:",
    "[Image 1] is the REQUIRED OPENING FRAME.",
    "Begin the generated video from the exact visible state of Image 1: preserve its subject identity, composition, camera position, environment, lighting, colors, and object layout at the opening moment.",
    "[Image 2] is the REQUIRED TARGET ENDING FRAME.",
    "During the shot, perform the described action and continuously move toward Image 2. At the final moment, converge as closely as possible to Image 2: preserve its subject state, pose, composition, camera position, environment, lighting, colors, and object layout.",
    "Do not swap the two image roles. Do not begin from Image 2. Do not reach Image 2 early and then move away. Avoid cuts, teleportation, scene replacement, unrelated objects, identity changes, and unexplained camera jumps.",
    "",
    "SCRIPT AND CAMERA DIRECTION:",
    script.trim(),
    "",
    "TIMELINE REQUIREMENT:",
    "Use one continuous shot. The first visible frame should match Image 1. The last visible frame should match Image 2 as closely as the model permits.",
  ].join("\n");
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text.slice(0, 2000) };
  }
}

function errorMessage(raw, fallback) {
  if (raw && typeof raw === "object") {
    for (const value of [raw.message, raw.Message, raw.code, raw.Code]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (raw.output && typeof raw.output === "object") {
      for (const value of [raw.output.message, raw.output.error_message, raw.output.code]) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  }
  return fallback;
}

function taskIdFromResponse(raw) {
  const output = raw && typeof raw === "object" && raw.output && typeof raw.output === "object"
    ? raw.output
    : {};
  return output.task_id || output.taskId || raw?.task_id || raw?.taskId || "";
}

function taskStatusFromResponse(raw) {
  const output = raw && typeof raw === "object" && raw.output && typeof raw.output === "object"
    ? raw.output
    : {};
  return String(output.task_status || output.taskStatus || raw?.task_status || raw?.taskStatus || "UNKNOWN")
    .trim()
    .toUpperCase();
}

function videoUrlFromResponse(raw) {
  const output = raw && typeof raw === "object" && raw.output && typeof raw.output === "object"
    ? raw.output
    : {};
  for (const value of [
    output.video_url,
    output.videoUrl,
    output.url,
    raw?.video_url,
    raw?.videoUrl,
    raw?.url,
  ]) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return "";
}

async function submitHappyHorse({ firstFrame, lastFrame, script, duration, resolution }) {
  const [firstFrameUrl, lastFrameUrl] = await Promise.all([
    uploadImage(decodeImage(firstFrame, "首帧"), "first"),
    uploadImage(decodeImage(lastFrame, "尾帧"), "last"),
  ]);
  const prompt = buildPrompt(script);
  const body = {
    model: MODEL,
    input: {
      prompt,
      media: [
        { type: "reference_image", url: firstFrameUrl },
        { type: "reference_image", url: lastFrameUrl },
      ],
    },
    parameters: {
      resolution,
      duration,
      watermark: false,
    },
  };
  const response = await fetch(`${config.baseUrl}${VIDEO_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });
  const raw = await safeJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(raw, `DashScope 提交失败 HTTP ${response.status}`));
  }
  const taskId = taskIdFromResponse(raw);
  if (!taskId) throw new Error(errorMessage(raw, "DashScope 未返回 task_id"));
  console.log(`[HappyHorse test] submitted task=${taskId} duration=${duration}s resolution=${resolution}`);
  return { taskId, firstFrameUrl, lastFrameUrl, prompt, submittedBody: body };
}

async function queryTask(taskId) {
  const response = await fetch(`${config.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
  });
  const raw = await safeJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(raw, `DashScope 查询失败 HTTP ${response.status}`));
  }
  const status = taskStatusFromResponse(raw);
  return {
    taskId,
    status,
    terminal: TERMINAL_STATUSES.has(status),
    succeeded: ["SUCCEEDED", "SUCCESS", "COMPLETED"].includes(status),
    videoUrl: videoUrlFromResponse(raw),
    error: ["FAILED", "ERROR", "CANCELED"].includes(status)
      ? errorMessage(raw, `任务终止：${status}`)
      : "",
    usage: raw?.usage || null,
    raw,
  };
}

function validatedGenerationInput(body) {
  const script = typeof body?.script === "string" ? body.script.trim() : "";
  if (!script) throw new Error("请填写剧本和镜头描述");
  if (script.length > 4200) throw new Error("剧本不能超过 4200 个字符");
  const duration = parseInteger(body?.duration, 5, 3, 15);
  const resolution = body?.resolution === "1080P" ? "1080P" : "720P";
  return {
    firstFrame: body?.firstFrame,
    lastFrame: body?.lastFrame,
    script,
    duration,
    resolution,
  };
}

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HappyHorse 首尾帧实验</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07101f; color: #e6edf7; }
    main { max-width: 1120px; margin: 32px auto; padding: 0 20px 60px; }
    h1 { margin-bottom: 8px; font-size: 28px; }
    .note { color: #9db0ca; line-height: 1.7; }
    .warning { padding: 12px 14px; border: 1px solid #745a1b; background: #241d0d; border-radius: 10px; color: #f6d681; }
    .card { margin-top: 20px; padding: 20px; background: #101c30; border: 1px solid #263a57; border-radius: 14px; }
    .frames { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    label { display: block; margin: 12px 0 7px; font-weight: 650; }
    input, textarea, select, button { font: inherit; }
    input[type=file], textarea, select { width: 100%; color: #e6edf7; background: #091426; border: 1px solid #365070; border-radius: 9px; padding: 10px; }
    textarea { min-height: 180px; resize: vertical; line-height: 1.55; }
    .preview { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; margin-top: 10px; border-radius: 9px; background: #050a12; border: 1px dashed #365070; }
    .settings { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    button { margin-top: 18px; padding: 11px 18px; color: white; background: #087f5b; border: 0; border-radius: 9px; cursor: pointer; font-weight: 700; }
    button:disabled { opacity: .55; cursor: wait; }
    pre { white-space: pre-wrap; word-break: break-word; color: #b9c8dc; background: #08111f; padding: 14px; border-radius: 9px; max-height: 360px; overflow: auto; }
    video { width: 100%; max-height: 680px; background: black; border-radius: 10px; }
    .hidden { display: none; }
    .status { font-size: 17px; color: #76e6bd; }
    a { color: #79c0ff; }
    @media (max-width: 720px) { .frames, .settings { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <h1>HappyHorse 1.1 R2V 首尾帧实验</h1>
  <p class="note">模型固定为项目现用的 <code>happyhorse-1.1-r2v</code>。两张图按 Image 1、Image 2 有序提交。</p>
  <p class="warning">注意：HappyHorse R2V 接收的是参考图，不提供原生 last_frame 硬约束。这个页面测试的是“Prompt 能否让结果接近指定尾帧”，不是保证首尾帧精确锁定。</p>

  <form id="form" class="card">
    <div class="frames">
      <section>
        <label for="first">首帧（Image 1）</label>
        <input id="first" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required>
        <img id="firstPreview" class="preview" alt="首帧预览">
      </section>
      <section>
        <label for="last">目标尾帧（Image 2）</label>
        <input id="last" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required>
        <img id="lastPreview" class="preview" alt="尾帧预览">
      </section>
    </div>
    <label for="script">剧本、动作和运镜</label>
    <textarea id="script" maxlength="4200" required placeholder="例如：一个连续镜头。人物从首帧的站姿缓慢向前走，镜头平稳跟随，随后转身坐下；最后两秒逐渐对齐尾帧中的姿态、机位、构图和光线。不要切镜。"></textarea>
    <div class="settings">
      <div>
        <label for="duration">视频秒数（3–15秒）</label>
        <input id="duration" type="number" min="3" max="15" step="1" value="5" required>
      </div>
      <div>
        <label for="resolution">分辨率</label>
        <select id="resolution"><option value="720P">720P（项目默认）</option><option value="1080P">1080P</option></select>
      </div>
    </div>
    <button id="submit" type="submit">提交生成测试</button>
  </form>

  <section id="result" class="card hidden">
    <p id="status" class="status"></p>
    <p id="task"></p>
    <video id="video" class="hidden" controls playsinline></video>
    <p id="videoLink" class="hidden"></p>
    <details>
      <summary>查看实际提交内容和上游响应</summary>
      <pre id="debug"></pre>
    </details>
  </section>
</main>
<script>
  const form = document.querySelector("#form");
  const submit = document.querySelector("#submit");
  const result = document.querySelector("#result");
  const statusText = document.querySelector("#status");
  const taskText = document.querySelector("#task");
  const video = document.querySelector("#video");
  const videoLink = document.querySelector("#videoLink");
  const debug = document.querySelector("#debug");

  function preview(input, image) {
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (file) image.src = URL.createObjectURL(file);
    });
  }
  preview(document.querySelector("#first"), document.querySelector("#firstPreview"));
  preview(document.querySelector("#last"), document.querySelector("#lastPreview"));

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function poll(taskId, submitted) {
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, ${POLL_INTERVAL_MS}));
      const response = await fetch("/api/task/" + encodeURIComponent(taskId), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "查询任务失败");
      statusText.textContent = "任务状态：" + payload.status;
      debug.textContent = JSON.stringify({ submitted, latest: payload.raw, usage: payload.usage }, null, 2);
      if (!payload.terminal) continue;
      if (!payload.succeeded) throw new Error(payload.error || "生成失败：" + payload.status);
      if (!payload.videoUrl) throw new Error("任务成功，但响应中没有找到视频 URL");
      video.src = payload.videoUrl;
      video.classList.remove("hidden");
      videoLink.innerHTML = '<a target="_blank" rel="noreferrer" href="' + payload.videoUrl.replace(/"/g, "&quot;") + '">新窗口打开或下载视频</a>';
      videoLink.classList.remove("hidden");
      statusText.textContent = "生成完成。请重点对比视频第一帧和最后一帧。";
      return;
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    submit.disabled = true;
    result.classList.remove("hidden");
    video.classList.add("hidden");
    videoLink.classList.add("hidden");
    statusText.textContent = "正在上传首尾帧并提交任务…";
    taskText.textContent = "";
    debug.textContent = "";
    try {
      const firstFile = document.querySelector("#first").files[0];
      const lastFile = document.querySelector("#last").files[0];
      if (!firstFile || !lastFile) throw new Error("请选择首帧和尾帧");
      const [firstFrame, lastFrame] = await Promise.all([fileToDataUrl(firstFile), fileToDataUrl(lastFile)]);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstFrame,
          lastFrame,
          script: document.querySelector("#script").value,
          duration: Number(document.querySelector("#duration").value),
          resolution: document.querySelector("#resolution").value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "任务提交失败");
      taskText.textContent = "Task ID：" + payload.taskId;
      statusText.textContent = "任务已提交，正在轮询…";
      debug.textContent = JSON.stringify(payload, null, 2);
      await poll(payload.taskId, payload);
    } catch (error) {
      statusText.textContent = "失败：" + (error instanceof Error ? error.message : String(error));
    } finally {
      submit.disabled = false;
    }
  });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === "GET" && url.pathname === "/") {
      return textResponse(res, 200, "text/html; charset=utf-8", PAGE);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse(res, 200, { ok: true, model: MODEL });
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = validatedGenerationInput(await readJsonBody(req));
      const result = await submitHappyHorse(input);
      return jsonResponse(res, 200, {
        ok: true,
        model: MODEL,
        warning: "Image 2 is a semantic target reference, not a native hard last-frame parameter.",
        ...result,
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/task/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/task/".length)).trim();
      if (!/^[A-Za-z0-9_-]{6,200}$/.test(taskId)) throw new Error("Task ID 无效");
      return jsonResponse(res, 200, await queryTask(taskId));
    }
    return jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[HappyHorse test]", error);
    return jsonResponse(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log("");
  console.log(`HappyHorse 首尾帧实验工具已启动：${url}`);
  console.log("按 Ctrl+C 停止。每次成功提交都会产生真实的 HappyHorse 调用费用。");
  console.log("");
  if (process.env.HAPPYHORSE_TEST_SMOKE === "true") {
    fetch(`${url}/health`)
      .then((response) => response.json())
      .then((payload) => {
        console.log(`[HappyHorse test] smoke OK: ${JSON.stringify(payload)}`);
        server.close();
      })
      .catch((error) => {
        console.error("[HappyHorse test] smoke failed:", error);
        process.exitCode = 1;
        server.close();
      });
    return;
  }
  if (process.platform === "win32" && process.env.HAPPYHORSE_TEST_NO_OPEN !== "true") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
});

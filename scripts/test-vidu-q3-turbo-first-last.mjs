#!/usr/bin/env node

/**
 * Vidu Q3 Turbo 原生首尾帧测试工具。
 *
 * 启动：
 *   npm run test:vidu-q3-first-last
 *
 * 配置（推荐放在 .env.local）：
 *   VIDU_API_KEY=your_api_key
 *   # 可选，默认 https://api.vidu.com
 *   VIDU_API_BASE_URL=https://api.vidu.com
 *
 * 浏览器：
 *   http://127.0.0.1:4318
 *
 * 官方接口：
 *   POST /ent/v2/start-end2video
 *   GET  /ent/v2/tasks/{taskId}/creations
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

const HOST = process.env.VIDU_TEST_HOST?.trim() || "127.0.0.1";
const PORT = parseInteger(process.env.VIDU_TEST_PORT, 4318, 1, 65535);
const MODEL = "viduq3-turbo";
const DEFAULT_BASE_URL = "https://api.vidu.com";
const START_END_PATH = "/ent/v2/start-end2video";
const MAX_VIDU_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_LOCAL_BODY_BYTES = 22 * 1024 * 1024;
const MAX_PROMPT_CHARS = 5000;
const POLL_INTERVAL_MS = 5000;

const RESOLUTION_CREDITS_PER_SECOND = {
  "540p": { normal: 7, offPeak: 4 },
  "720p": { normal: 11, offPeak: 6 },
  "1080p": { normal: 13, offPeak: 7 },
};

function parseInteger(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function apiKey() {
  const key = process.env.VIDU_API_KEY?.trim() || "";
  if (!key) {
    throw new Error("未配置 VIDU_API_KEY。请在项目 .env.local 中添加 VIDU_API_KEY=你的密钥，然后重新启动本工具。");
  }
  return key;
}

function apiBaseUrl() {
  return (process.env.VIDU_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

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
    if (total > MAX_LOCAL_BODY_BYTES) {
      throw new Error("两张图片和请求内容超过限制，请压缩图片后重试（Vidu 请求体上限为 20MB）");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求 JSON 格式无效");
  }
}

function validatedDataUrl(value, label) {
  if (typeof value !== "string") throw new Error(`请选择${label}`);
  const match = value.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error(`${label}格式无效，仅支持 JPG、PNG、WebP`);
  if (!match[2]) throw new Error(`${label}为空`);
  return value;
}

function validatedGenerationInput(body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("请填写剧本、动作和运镜描述");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`剧本不能超过 ${MAX_PROMPT_CHARS} 个字符`);
  }
  const duration = Number(body?.duration);
  if (!Number.isInteger(duration) || duration < 1 || duration > 16) {
    throw new Error("视频秒数必须是 1–16 的整数");
  }
  const resolution = String(body?.resolution || "");
  if (!(resolution in RESOLUTION_CREDITS_PER_SECOND)) {
    throw new Error("分辨率只支持 540p、720p 或 1080p");
  }
  const seedRaw = body?.seed;
  let seed;
  if (seedRaw !== undefined && seedRaw !== null && seedRaw !== "") {
    seed = Number(seedRaw);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) {
      throw new Error("随机种子必须是 0–2147483647 的整数");
    }
  }
  return {
    firstFrame: validatedDataUrl(body?.firstFrame, "首帧"),
    lastFrame: validatedDataUrl(body?.lastFrame, "尾帧"),
    prompt,
    duration,
    resolution,
    audio: body?.audio !== false,
    offPeak: body?.offPeak === true,
    seed,
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text.slice(0, 3000) };
  }
}

function upstreamError(raw, fallback) {
  if (raw && typeof raw === "object") {
    for (const value of [
      raw.message,
      raw.error,
      raw.err_msg,
      raw.err_code,
      raw.code,
      raw.rawText,
    ]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallback;
}

function taskIdFromResponse(raw) {
  if (!raw || typeof raw !== "object") return "";
  for (const value of [raw.task_id, raw.taskId, raw.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stateFromResponse(raw) {
  if (!raw || typeof raw !== "object") return "unknown";
  return String(raw.state || raw.status || "unknown").trim().toLowerCase();
}

function creationFromResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.creations)) return null;
  return raw.creations.find((item) =>
    item
    && typeof item === "object"
    && typeof item.url === "string"
    && /^https?:\/\//i.test(item.url)
  ) || null;
}

function estimatedCredits(duration, resolution, offPeak) {
  const rate = RESOLUTION_CREDITS_PER_SECOND[resolution];
  return duration * (offPeak ? rate.offPeak : rate.normal);
}

async function submitVidu(input) {
  const body = {
    model: MODEL,
    images: [input.firstFrame, input.lastFrame],
    prompt: input.prompt,
    is_rec: false,
    duration: input.duration,
    resolution: input.resolution,
    audio: input.audio,
    off_peak: input.offPeak,
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    payload: JSON.stringify({
      source: "RenYiMen Vidu Q3 Turbo first-last test",
      submittedAt: new Date().toISOString(),
    }),
  };
  const encodedBody = JSON.stringify(body);
  const byteLength = Buffer.byteLength(encodedBody);
  if (byteLength > MAX_VIDU_REQUEST_BYTES) {
    throw new Error(
      `Vidu 请求体为 ${(byteLength / 1024 / 1024).toFixed(2)}MB，超过官方 20MB 上限；请压缩首尾帧后重试`
    );
  }
  const response = await fetch(`${apiBaseUrl()}${START_END_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${apiKey()}`,
    },
    body: encodedBody,
  });
  const raw = await safeJson(response);
  if (!response.ok) {
    throw new Error(upstreamError(raw, `Vidu 提交失败 HTTP ${response.status}`));
  }
  const taskId = taskIdFromResponse(raw);
  if (!taskId) throw new Error(upstreamError(raw, "Vidu 未返回 task_id"));
  console.log(
    `[Vidu Q3 test] submitted task=${taskId} duration=${input.duration}s resolution=${input.resolution} audio=${input.audio} offPeak=${input.offPeak}`
  );
  return {
    taskId,
    state: stateFromResponse(raw),
    estimatedCredits: estimatedCredits(input.duration, input.resolution, input.offPeak),
    requestSummary: {
      model: MODEL,
      images: ["[首帧 Base64 已隐藏]", "[尾帧 Base64 已隐藏]"],
      prompt: input.prompt,
      is_rec: false,
      duration: input.duration,
      resolution: input.resolution,
      audio: input.audio,
      off_peak: input.offPeak,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      requestBytes: byteLength,
    },
    raw,
  };
}

async function queryTask(taskId) {
  const response = await fetch(
    `${apiBaseUrl()}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Token ${apiKey()}`,
      },
      cache: "no-store",
    }
  );
  const raw = await safeJson(response);
  if (!response.ok) {
    throw new Error(upstreamError(raw, `Vidu 查询失败 HTTP ${response.status}`));
  }
  const state = stateFromResponse(raw);
  const creation = creationFromResponse(raw);
  return {
    taskId,
    state,
    progress:
      typeof raw?.progress === "number" && Number.isFinite(raw.progress)
        ? raw.progress
        : null,
    terminal: state === "success" || state === "failed",
    succeeded: state === "success",
    videoUrl: creation?.url || "",
    coverUrl:
      typeof creation?.cover_url === "string" ? creation.cover_url : "",
    creationId:
      typeof creation?.id === "string" ? creation.id : "",
    credits:
      typeof raw?.credits === "number" || typeof raw?.credits === "string"
        ? raw.credits
        : null,
    error:
      state === "failed"
        ? upstreamError(raw, "Vidu 任务生成失败")
        : "",
    raw,
  };
}

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vidu Q3 Turbo 原生首尾帧测试</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07101f; color: #e7eef8; }
    main { max-width: 1140px; margin: 30px auto; padding: 0 20px 60px; }
    h1 { margin-bottom: 8px; font-size: 28px; }
    code { color: #9bdcff; }
    .note { color: #a8b8ce; line-height: 1.7; }
    .success-note { padding: 12px 14px; border: 1px solid #176b52; background: #0c2b24; border-radius: 10px; color: #8ff0c7; }
    .config-note { padding: 12px 14px; border: 1px solid #66531c; background: #241d0d; border-radius: 10px; color: #f1d47a; }
    .card { margin-top: 20px; padding: 20px; background: #101c30; border: 1px solid #263c59; border-radius: 14px; }
    .frames { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    label { display: block; margin: 12px 0 7px; font-weight: 650; }
    input, textarea, select, button { font: inherit; }
    input[type=file], input[type=number], textarea, select {
      width: 100%; color: #e7eef8; background: #091426;
      border: 1px solid #365070; border-radius: 9px; padding: 10px;
    }
    textarea { min-height: 190px; resize: vertical; line-height: 1.55; }
    .preview { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; margin-top: 10px; border-radius: 9px; background: #050a12; border: 1px dashed #365070; }
    .settings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .checks { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 14px; }
    .checks label { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 500; }
    button { margin-top: 18px; padding: 11px 18px; color: white; background: #7065e8; border: 0; border-radius: 9px; cursor: pointer; font-weight: 750; }
    button:disabled { opacity: .55; cursor: wait; }
    pre { white-space: pre-wrap; word-break: break-word; color: #bdcbe0; background: #08111f; padding: 14px; border-radius: 9px; max-height: 380px; overflow: auto; }
    video { width: 100%; max-height: 680px; background: black; border-radius: 10px; }
    .hidden { display: none; }
    .status { font-size: 17px; color: #90e5c7; }
    .estimate { color: #bdcbe0; }
    a { color: #82c7ff; }
    @media (max-width: 760px) { .frames, .settings { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <h1>Vidu Q3 Turbo 原生首尾帧测试</h1>
  <p class="note">固定模型：<code>viduq3-turbo</code>；官方原生接口：<code>/ent/v2/start-end2video</code>。</p>
  <p class="success-note">这是真正的首尾帧接口：第一张图是起始帧，第二张图是结束帧，不是普通参考图模拟。</p>
  <p id="configNote" class="config-note">正在检查 VIDU_API_KEY…</p>

  <form id="form" class="card">
    <div class="frames">
      <section>
        <label for="first">首帧（Start Frame）</label>
        <input id="first" type="file" accept="image/jpeg,image/png,image/webp" required>
        <img id="firstPreview" class="preview" alt="首帧预览">
      </section>
      <section>
        <label for="last">尾帧（End Frame）</label>
        <input id="last" type="file" accept="image/jpeg,image/png,image/webp" required>
        <img id="lastPreview" class="preview" alt="尾帧预览">
      </section>
    </div>
    <p class="note">两张图片宽高比需接近，官方要求两者宽高比之比处于 0.8–1.25。两图转 Base64 后的总请求体不能超过 20MB。</p>

    <label for="prompt">剧本、人物动作、对白、音效和运镜</label>
    <textarea id="prompt" maxlength="${MAX_PROMPT_CHARS}" required placeholder="例如：一个连续镜头。人物从首帧中的站姿向镜头右侧缓慢走去，镜头平稳横移跟随；人物拿起桌上的杯子，转身坐下，动作自然连贯，最后准确到达尾帧中的姿势、机位和构图。环境声为轻微风声，不要切镜，不要瞬移。"></textarea>

    <div class="settings">
      <div>
        <label for="duration">视频秒数（1–16秒）</label>
        <input id="duration" type="number" min="1" max="16" step="1" value="5" required>
      </div>
      <div>
        <label for="resolution">分辨率</label>
        <select id="resolution">
          <option value="540p">540p</option>
          <option value="720p" selected>720p</option>
          <option value="1080p">1080p</option>
        </select>
      </div>
      <div>
        <label for="seed">随机种子（可留空）</label>
        <input id="seed" type="number" min="0" max="2147483647" step="1" placeholder="随机">
      </div>
    </div>
    <div class="checks">
      <label><input id="audio" type="checkbox" checked> 生成同步声音</label>
      <label><input id="offPeak" type="checkbox"> 错峰低价模式（可能在48小时内完成）</label>
    </div>
    <p id="estimate" class="estimate"></p>
    <button id="submit" type="submit">提交 Vidu Q3 Turbo 测试</button>
  </form>

  <section id="result" class="card hidden">
    <p id="status" class="status"></p>
    <p id="task"></p>
    <video id="video" class="hidden" controls playsinline></video>
    <p id="videoLink" class="hidden"></p>
    <details>
      <summary>查看实际请求摘要和 Vidu 原始响应</summary>
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
  const configNote = document.querySelector("#configNote");
  const durationInput = document.querySelector("#duration");
  const resolutionInput = document.querySelector("#resolution");
  const offPeakInput = document.querySelector("#offPeak");
  const estimate = document.querySelector("#estimate");
  let dimensions = { first: null, last: null };

  fetch("/health", { cache: "no-store" })
    .then(response => response.json())
    .then(payload => {
      configNote.textContent = payload.apiKeyConfigured
        ? "VIDU_API_KEY 已配置，可以提交真实生成任务。"
        : "尚未配置 VIDU_API_KEY：请在 .env.local 添加 VIDU_API_KEY=你的密钥，然后重启本工具。";
    })
    .catch(() => { configNote.textContent = "无法读取本地配置状态。"; });

  function preview(input, image, role) {
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        dimensions[role] = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(objectUrl);
      };
      image.src = objectUrl;
    });
  }
  preview(document.querySelector("#first"), document.querySelector("#firstPreview"), "first");
  preview(document.querySelector("#last"), document.querySelector("#lastPreview"), "last");

  function validateAspectRatios() {
    if (!dimensions.first || !dimensions.last) return;
    const firstRatio = dimensions.first.width / dimensions.first.height;
    const lastRatio = dimensions.last.width / dimensions.last.height;
    const ratio = firstRatio / lastRatio;
    if (ratio < 0.8 || ratio > 1.25) {
      throw new Error("首尾帧宽高比差异过大，请裁剪成接近的画幅后重试");
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  function refreshEstimate() {
    const duration = Math.max(1, Math.min(16, Number(durationInput.value) || 5));
    const rates = {
      "540p": { normal: 7, offPeak: 4 },
      "720p": { normal: 11, offPeak: 6 },
      "1080p": { normal: 13, offPeak: 7 },
    };
    const rate = rates[resolutionInput.value];
    const credits = duration * (offPeakInput.checked ? rate.offPeak : rate.normal);
    estimate.textContent = "官方预估消耗：" + credits + " Vidu Credits（最终以上游账单为准）";
  }
  durationInput.addEventListener("input", refreshEstimate);
  resolutionInput.addEventListener("change", refreshEstimate);
  offPeakInput.addEventListener("change", refreshEstimate);
  refreshEstimate();

  async function poll(taskId, submitted) {
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, ${POLL_INTERVAL_MS}));
      const response = await fetch("/api/task/" + encodeURIComponent(taskId), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "查询 Vidu 任务失败");
      const progress = payload.progress === null ? "" : "（" + payload.progress + "%）";
      statusText.textContent = "任务状态：" + payload.state + progress;
      debug.textContent = JSON.stringify({ submitted, latest: payload.raw }, null, 2);
      if (!payload.terminal) continue;
      if (!payload.succeeded) throw new Error(payload.error || "Vidu 生成失败");
      if (!payload.videoUrl) throw new Error("任务成功，但响应中没有找到视频 URL");
      video.src = payload.videoUrl;
      video.classList.remove("hidden");
      videoLink.innerHTML = '<a target="_blank" rel="noreferrer" href="' + payload.videoUrl.replace(/"/g, "&quot;") + '">新窗口打开或下载视频（Vidu 链接通常24小时有效）</a>';
      videoLink.classList.remove("hidden");
      statusText.textContent = "生成完成；实际消耗：" + (payload.credits ?? "—") + " Credits。请对比视频首帧、尾帧与两张输入图。";
      return;
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    submit.disabled = true;
    result.classList.remove("hidden");
    video.classList.add("hidden");
    videoLink.classList.add("hidden");
    statusText.textContent = "正在读取首尾帧并提交 Vidu…";
    taskText.textContent = "";
    debug.textContent = "";
    try {
      validateAspectRatios();
      const firstFile = document.querySelector("#first").files[0];
      const lastFile = document.querySelector("#last").files[0];
      if (!firstFile || !lastFile) throw new Error("请选择首帧和尾帧");
      const [firstFrame, lastFrame] = await Promise.all([
        fileToDataUrl(firstFile),
        fileToDataUrl(lastFile),
      ]);
      const seedValue = document.querySelector("#seed").value;
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstFrame,
          lastFrame,
          prompt: document.querySelector("#prompt").value,
          duration: Number(durationInput.value),
          resolution: resolutionInput.value,
          audio: document.querySelector("#audio").checked,
          offPeak: offPeakInput.checked,
          seed: seedValue === "" ? null : Number(seedValue),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vidu 任务提交失败");
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
      return jsonResponse(res, 200, {
        ok: true,
        model: MODEL,
        apiBaseUrl: apiBaseUrl(),
        apiKeyConfigured: Boolean(process.env.VIDU_API_KEY?.trim()),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = validatedGenerationInput(await readJsonBody(req));
      return jsonResponse(res, 200, {
        ok: true,
        ...(await submitVidu(input)),
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/task/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/task/".length)).trim();
      if (!/^[A-Za-z0-9_-]{6,200}$/.test(taskId)) throw new Error("Task ID 无效");
      return jsonResponse(res, 200, await queryTask(taskId));
    }
    return jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[Vidu Q3 test]", error);
    return jsonResponse(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log("");
  console.log(`Vidu Q3 Turbo 首尾帧测试工具已启动：${url}`);
  console.log(`VIDU_API_KEY：${process.env.VIDU_API_KEY?.trim() ? "已配置" : "未配置"}`);
  console.log("按 Ctrl+C 停止。点击页面提交按钮会产生真实的 Vidu Credits 消耗。");
  console.log("");
  if (process.env.VIDU_TEST_SMOKE === "true") {
    fetch(`${url}/health`)
      .then((response) => response.json())
      .then((payload) => {
        console.log(`[Vidu Q3 test] smoke OK: ${JSON.stringify(payload)}`);
        server.close();
      })
      .catch((error) => {
        console.error("[Vidu Q3 test] smoke failed:", error);
        process.exitCode = 1;
        server.close();
      });
    return;
  }
  if (process.platform === "win32" && process.env.VIDU_TEST_NO_OPEN !== "true") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
});

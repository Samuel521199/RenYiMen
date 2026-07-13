"use client";

import { useState } from "react";

import { useLanguage } from "@/lib/LanguageContext";
import type { MotionData, MotionKeypoint } from "@/lib/video-workflow";

const MOTION_LABELS = [
  { zh: "静止", en: "idle, subtle breathing", emoji: "😐" },
  { zh: "抬头", en: "slowly looks up", emoji: "⬆️" },
  { zh: "低头", en: "slowly looks down", emoji: "⬇️" },
  { zh: "惊喜", en: "surprised and delighted, eyes wide open with joy", emoji: "😲" },
  { zh: "吃惊", en: "shocked and stunned, jaw dropped", emoji: "😱" },
  { zh: "开心", en: "happy, smiling and cheerful", emoji: "😄" },
  { zh: "大笑", en: "laughing out loud", emoji: "😂" },
  { zh: "转身", en: "turns around", emoji: "↩️" },
  { zh: "前进", en: "moves forward toward camera", emoji: "▶️" },
  { zh: "后退", en: "steps back", emoji: "◀️" },
  { zh: "点头", en: "nods head in agreement", emoji: "👍" },
  { zh: "摇头", en: "shakes head", emoji: "🙅" },
  { zh: "招手", en: "waves hand to greet", emoji: "👋" },
];

const LABEL_DISPLAY_MAP: Record<string, { zh: string; emoji: string }> = {
  "idle, subtle breathing": { zh: "静止", emoji: "😐" },
  "slowly looks up": { zh: "抬头", emoji: "⬆️" },
  "slowly looks down": { zh: "低头", emoji: "⬇️" },
  "surprised and delighted, eyes wide open with joy": { zh: "惊喜", emoji: "😲" },
  "shocked and stunned, jaw dropped": { zh: "吃惊", emoji: "😱" },
  "happy, smiling and cheerful": { zh: "开心", emoji: "😄" },
  "laughing out loud": { zh: "大笑", emoji: "😂" },
  "turns around": { zh: "转身", emoji: "↩️" },
  "moves forward toward camera": { zh: "前进", emoji: "▶️" },
  "steps back": { zh: "后退", emoji: "◀️" },
  "nods head in agreement": { zh: "点头", emoji: "👍" },
  "shakes head": { zh: "摇头", emoji: "🙅" },
  "waves hand to greet": { zh: "招手", emoji: "👋" },
};

function getLabelDisplay(label: string, lang: string) {
  const match = LABEL_DISPLAY_MAP[label];
  if (!match) return { primary: label, secondary: "" };
  return lang === "zh"
    ? { primary: `${match.emoji} ${match.zh}`, secondary: label }
    : { primary: `${match.emoji} ${match.zh}`, secondary: "" };
}

interface VideoEnumOption {
  value: string;
  label_zh: string;
}

interface Props {
  draftVideoUrl?: string;
  firstFrameUrl?: string;
  duration?: number;
  motionData?: MotionData;
  jobId?: string;
  modelConfigId?: number;
  actionOptions?: VideoEnumOption[];
  onCreateAction?: (labelZh: string, value: string) => Promise<void>;
  onSave: (data: MotionData) => void;
}

export default function MotionExtractor({
  draftVideoUrl,
  firstFrameUrl,
  duration = 5,
  motionData,
  jobId,
  modelConfigId,
  actionOptions,
  onCreateAction,
  onSave,
}: Props) {
  const { t, lang } = useLanguage();
  const [keypoints, setKeypoints] = useState<MotionKeypoint[]>(motionData?.raw_keypoints ?? []);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState("idle");
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState("");
  const [showCustomAction, setShowCustomAction] = useState(false);
  const [customActionLabel, setCustomActionLabel] = useState("");
  const [customActionValue, setCustomActionValue] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);
  const motionLabels = actionOptions?.length
    ? actionOptions.map((item) => ({ zh: item.label_zh, en: item.value, emoji: "" }))
    : MOTION_LABELS;

  const handleCreateAction = async () => {
    if (!onCreateAction || !customActionLabel.trim() || !customActionValue.trim()) return;
    setCreatingAction(true);
    try {
      await onCreateAction(customActionLabel.trim(), customActionValue.trim());
      setSelectedLabel(customActionValue.trim());
      setCustomActionLabel("");
      setCustomActionValue("");
      setShowCustomAction(false);
    } finally {
      setCreatingAction(false);
    }
  };

  const handleAutoExtract = async () => {
    if (!draftVideoUrl || !jobId || !modelConfigId) return;
    setAutoLoading(true);
    setAutoError("");
    try {
      const res = await fetch(`/api/video/motion/auto-extract/${jobId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          draft_video_url: draftVideoUrl,
          model_config_id: modelConfigId,
          duration,
        }),
      });
      const data = await res.json();
      if (data.code !== 0) {
        setAutoError(data.msg || "自动提炼失败");
        return;
      }
      const newKeypoints: MotionKeypoint[] = data.data.keypoints.map((k: any) => ({
        timestamp: k.timestamp,
        label: k.label,
      }));
      setKeypoints(newKeypoints);
    } catch {
      setAutoError("请求失败，请重试");
    } finally {
      setAutoLoading(false);
    }
  };

  const addKeypoint = () => {
    const existing = keypoints.find((point) => Math.abs(point.timestamp - currentTime) < 0.2);
    if (existing) return;
    const next = [...keypoints, { timestamp: currentTime, label: selectedLabel }].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    setKeypoints(next);
  };

  const removeKeypoint = (idx: number) => {
    setKeypoints((prev) => prev.filter((_, index) => index !== idx));
  };

  const handleSave = () => {
    const motion_sequence = keypoints.map((point) => point.label);
    const timing: Record<string, number> = {};
    keypoints.forEach((point) => {
      timing[point.label] = point.timestamp;
    });
    onSave({
      motion_sequence,
      timing,
      raw_keypoints: keypoints,
    });
  };

  const pct = (time: number) => `${((time / duration) * 100).toFixed(1)}%`;

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-gray-900">{t("动作提炼")}</h2>
      <p className="mb-5 text-sm text-gray-500">{t("动作提炼说明")}</p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-4">
          {draftVideoUrl ? (
            <div className="relative">
              <div className="mb-1 text-xs font-medium text-gray-500">{t("草稿视频")}</div>
              <video
                src={draftVideoUrl}
                controls
                poster={firstFrameUrl}
                className="w-full rounded-xl border border-gray-200 bg-black"
                style={{ maxHeight: "280px" }}
                onTimeUpdate={(event) => setCurrentTime((event.target as HTMLVideoElement).currentTime)}
              />
              {/* AI 按钮 overlay */}
              <div className="absolute top-7 right-2 z-10">
                <button
                  onClick={handleAutoExtract}
                  disabled={!draftVideoUrl || !modelConfigId || autoLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-md hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {autoLoading ? (
                    <>
                      <span className="animate-spin">⏳</span> AI 分析中...
                    </>
                  ) : (
                    <>✨ AI 自动提炼</>
                  )}
                </button>
              </div>
              {autoLoading && (
                <div className="mt-1 text-right text-xs text-purple-400">Gemini 分析中，约 10-20 秒...</div>
              )}
              {autoError && (
                <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">
                  {autoError}
                </div>
              )}
              <div className="mt-1 text-right text-xs text-gray-400">
                {t("当前时间")}: {currentTime.toFixed(2)}s
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 px-4 text-center text-sm text-gray-400">
              {t("请先在 Step 2 选择草稿")}
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("时间轴")}</div>
            <div className="relative h-8 rounded-lg border border-gray-200 bg-gray-100">
              <div className="absolute inset-0 overflow-hidden rounded-lg">
                {keypoints.map((point, index) => (
                  <div
                    key={index}
                    className="absolute top-0 bottom-0 w-0.5 bg-blue-500"
                    style={{ left: pct(point.timestamp) }}
                    title={`${point.label} @ ${point.timestamp.toFixed(2)}s`}
                  />
                ))}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-400"
                  style={{ left: pct(currentTime) }}
                />
              </div>
              <div className="absolute bottom-0 left-0 px-1 text-[10px] text-gray-400">0s</div>
              <div className="absolute bottom-0 right-0 px-1 text-[10px] text-gray-400">{duration}s</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("动作标签")}</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {motionLabels.map((label) => (
                <button
                  key={label.en}
                  onClick={() => setSelectedLabel(label.en)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-all ${
                    selectedLabel === label.en
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:border-blue-200"
                  }`}
                >
                  {label.emoji && <span>{label.emoji}</span>}
                  <span>{lang === "zh" ? label.zh : label.en}</span>
                </button>
              ))}
              {onCreateAction && (
                <button
                  onClick={() => setShowCustomAction((value) => !value)}
                  className="rounded-full border border-dashed border-blue-300 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50"
                >
                  + 自定义
                </button>
              )}
            </div>
            {showCustomAction && (
              <div className="mb-3 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input
                  value={customActionLabel}
                  onChange={(event) => setCustomActionLabel(event.target.value)}
                  placeholder="中文名"
                  className="rounded-md border border-blue-100 px-2 py-1 text-xs outline-none"
                />
                <input
                  value={customActionValue}
                  onChange={(event) => setCustomActionValue(event.target.value)}
                  placeholder="English value"
                  className="rounded-md border border-blue-100 px-2 py-1 text-xs outline-none"
                />
                <button
                  onClick={handleCreateAction}
                  disabled={creatingAction || !customActionLabel.trim() || !customActionValue.trim()}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40"
                >
                  确认
                </button>
                <button
                  onClick={() => setShowCustomAction(false)}
                  className="rounded-md px-3 py-1 text-xs text-gray-500 hover:bg-white"
                >
                  取消
                </button>
              </div>
            )}
            <button
              onClick={addKeypoint}
              disabled={!draftVideoUrl}
              className="w-full rounded-lg border-2 border-dashed border-blue-300 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              + {t("在")} {currentTime.toFixed(2)}s {t("标记")} [{selectedLabel}]
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-500">
              {t("关键帧")} ({keypoints.length})
            </div>
            {keypoints.length > 0 && (
              <button onClick={() => setKeypoints([])} className="text-xs text-red-400 hover:underline">
                {t("清空")}
              </button>
            )}
          </div>

          {keypoints.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 px-4 text-center text-sm text-gray-400">
              {t("播放视频，在关键时间点标记动作")}
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {keypoints.map((point, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                  <div className="w-12 flex-shrink-0 font-mono text-xs text-blue-600">
                    {point.timestamp.toFixed(2)}s
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-gray-700">
                      {getLabelDisplay(point.label, lang).primary}
                    </div>
                    {getLabelDisplay(point.label, lang).secondary && (
                      <div className="text-xs text-gray-400">{getLabelDisplay(point.label, lang).secondary}</div>
                    )}
                  </div>
                  <button onClick={() => removeKeypoint(index)} className="text-xs text-gray-300 hover:text-red-400">
                    X
                  </button>
                </div>
              ))}
            </div>
          )}

          {keypoints.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="mb-1 text-xs font-medium text-gray-500">{t("动作序列")}</div>
                <div className="text-sm text-gray-700">
                  {keypoints.map((point) => getLabelDisplay(point.label, lang).primary).join(" → ")}
                </div>
              </div>
              <button
                onClick={handleSave}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700"
              >
                ✓ {t("确认动作结构，继续下一步")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

import { useLanguage } from "@/lib/LanguageContext";
import type { VideoDraftItem } from "@/lib/video-workflow";

const EMOTION_PRESETS = [
  { zh: "惊喜", en: "surprised and delighted, eyes wide open with joy", emoji: "😲" },
  { zh: "吃惊", en: "shocked and stunned, jaw dropped in disbelief", emoji: "😱" },
  { zh: "开心", en: "happy and cheerful, big smile", emoji: "😄" },
  { zh: "大笑", en: "laughing out loud, extremely amused", emoji: "😂" },
  { zh: "期待", en: "excited and anticipating, eager expression", emoji: "🤩" },
  { zh: "温暖", en: "warm and friendly, gentle smile", emoji: "🤗" },
  { zh: "紧张", en: "tense and focused, serious expression", emoji: "😤" },
  { zh: "害羞", en: "shy and bashful, slightly embarrassed", emoji: "😊" },
  { zh: "傲娇", en: "tsundere, playfully smug with hidden affection", emoji: "😏" },
  { zh: "搞笑", en: "funny and playful, goofy expression", emoji: "🤪" },
  { zh: "酷炫", en: "cool and confident, stylish attitude", emoji: "😎" },
  { zh: "感动", en: "touched and moved, emotional with gratitude", emoji: "🥹" },
  { zh: "疑惑", en: "confused and puzzled, tilting head", emoji: "🤔" },
  { zh: "得意", en: "proud and triumphant, victorious expression", emoji: "😤" },
  { zh: "撒娇", en: "cute and pouty, acting adorable", emoji: "🥺" },
];

const ASPECT_RATIOS = [
  { label: "TikTok / Reels  9:16", value: "9:16", size: "1080x1920" },
  { label: "Facebook  16:9", value: "16:9", size: "1920x1080" },
  { label: "1:1", value: "1:1", size: "1080x1080" },
];

interface VideoEnumOption {
  value: string;
  label_zh: string;
}

interface Props {
  firstFrameUrl?: string;
  emotion?: string;
  prompt?: string;
  aspectRatio?: string;
  modelConfigId?: number;
  draftCount?: number;
  duration?: number;
  sound?: boolean;
  availableModels?: { id: number; name: string; model_name: string }[];
  emotionOptions?: VideoEnumOption[];
  drafts: VideoDraftItem[];
  selectedDraftId?: string;
  generating?: boolean;
  onModelChange: (id: number) => void;
  onDraftCountChange: (count: number) => void;
  onDurationChange: (duration: number) => void;
  onEmotionChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
  onSoundChange: (value: boolean) => void;
  onCreateEmotion?: (labelZh: string, value: string) => Promise<void>;
  onGenerate: () => void;
  onSelectDraft: (id: string) => void;
}

export default function DraftExplorer({
  firstFrameUrl,
  emotion,
  prompt,
  aspectRatio = "9:16",
  modelConfigId,
  draftCount = 5,
  duration = 5,
  sound = false,
  availableModels,
  emotionOptions,
  drafts,
  selectedDraftId,
  generating = false,
  onModelChange,
  onDraftCountChange,
  onDurationChange,
  onEmotionChange,
  onPromptChange,
  onAspectRatioChange,
  onSoundChange,
  onCreateEmotion,
  onGenerate,
  onSelectDraft,
}: Props) {
  const { t, lang } = useLanguage();
  const [showOnlyDone, setShowOnlyDone] = useState(false);
  const [showCustomEmotion, setShowCustomEmotion] = useState(false);
  const [customEmotionLabel, setCustomEmotionLabel] = useState("");
  const [customEmotionValue, setCustomEmotionValue] = useState("");
  const [creatingEmotion, setCreatingEmotion] = useState(false);
  const visibleDrafts = showOnlyDone
    ? drafts.filter((draft) => draft.status === "done" || draft.status === "selected")
    : drafts;
  const emotionPresets = emotionOptions?.length
    ? emotionOptions.map((item) => ({ zh: item.label_zh, en: item.value, emoji: "" }))
    : EMOTION_PRESETS;

  const handleCreateEmotion = async () => {
    if (!onCreateEmotion || !customEmotionLabel.trim() || !customEmotionValue.trim()) return;
    setCreatingEmotion(true);
    try {
      await onCreateEmotion(customEmotionLabel.trim(), customEmotionValue.trim());
      onEmotionChange(customEmotionValue.trim());
      setCustomEmotionLabel("");
      setCustomEmotionValue("");
      setShowCustomEmotion(false);
    } finally {
      setCreatingEmotion(false);
    }
  };

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-gray-900">{t("草稿探索")}</h2>
      <p className="mb-5 text-sm text-gray-500">{t("草稿探索说明")}</p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-4">
          {firstFrameUrl && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">{t("首帧")}</div>
              <img
                src={firstFrameUrl}
                alt="first frame"
                className="h-24 w-auto rounded-lg border border-gray-200 object-cover"
              />
            </div>
          )}

          {availableModels && availableModels.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">{t("生成模型")}</div>
              <select
                value={modelConfigId ?? ""}
                onChange={(event) => onModelChange(Number(event.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                <option value="">{t("请选择模型")}</option>
                {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                    {model.name}
                </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("情绪")}</div>
            <div className="flex flex-wrap gap-2">
              {emotionPresets.map((preset) => (
                <button
                  key={preset.en}
                  onClick={() => onEmotionChange(emotion === preset.en ? "" : preset.en)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-all ${
                    emotion === preset.en
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:border-blue-200"
                  }`}
                >
                  {preset.emoji && <span>{preset.emoji}</span>}
                  <span>{lang === "zh" ? preset.zh : preset.en}</span>
                </button>
              ))}
              {onCreateEmotion && (
                <button
                  onClick={() => setShowCustomEmotion((value) => !value)}
                  className="rounded-full border border-dashed border-blue-300 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
                >
                  + 自定义
                </button>
              )}
            </div>
            {showCustomEmotion && (
              <div className="mt-2 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input
                  value={customEmotionLabel}
                  onChange={(event) => setCustomEmotionLabel(event.target.value)}
                  placeholder="中文名"
                  className="rounded-md border border-blue-100 px-2 py-1 text-xs outline-none"
                />
                <input
                  value={customEmotionValue}
                  onChange={(event) => setCustomEmotionValue(event.target.value)}
                  placeholder="English value"
                  className="rounded-md border border-blue-100 px-2 py-1 text-xs outline-none"
                />
                <button
                  onClick={handleCreateEmotion}
                  disabled={creatingEmotion || !customEmotionLabel.trim() || !customEmotionValue.trim()}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40"
                >
                  确认
                </button>
                <button
                  onClick={() => setShowCustomEmotion(false)}
                  className="rounded-md px-3 py-1 text-xs text-gray-500 hover:bg-white"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("生成数量")}</div>
            <div className="flex gap-2">
              {[1, 3, 5].map((count) => (
                <button
                  key={count}
                  onClick={() => onDraftCountChange(count)}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-all ${
                    draftCount === count
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-500 hover:border-blue-200"
                  }`}
                >
                  {count} {t("条")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("视频时长")}</div>
            <div className="flex gap-2">
              {[5, 10].map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => onDurationChange(seconds)}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-all ${
                    duration === seconds
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-500 hover:border-blue-200"
                  }`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-gray-500">{t("动作描述")}</div>
            <textarea
              value={prompt ?? ""}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder={t("简单描述角色动作，如：慢慢抬头，眼神惊喜...")}
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              maxLength={200}
            />
            <div className="mt-0.5 text-right text-xs text-gray-400">{(prompt ?? "").length}/200</div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("画面比例")}</div>
            <div className="flex gap-2">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.value}
                  onClick={() => onAspectRatioChange(ratio.value)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                    aspectRatio === ratio.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-500 hover:border-blue-200"
                  }`}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
            <div>
              <div className="text-sm font-medium text-gray-700">{t("生成音效")}</div>
              <div className="text-xs text-gray-400">{t("由 Kling 自动生成背景音效")}</div>
            </div>
            <button
              onClick={() => onSoundChange(!sound)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sound ? "bg-blue-600" : "bg-gray-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  sound ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <button
            onClick={onGenerate}
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <>
                <span className="animate-spin">⏳</span>
                {t("生成中...")}
              </>
            ) : (
              <>
                <span>🎬</span>
                {drafts.length > 0 ? t("重新生成") : t("开始生成草稿")}
              </>
            )}
          </button>

          {drafts.length > 0 && (
            <p className="text-center text-xs text-gray-400">
              {t("已生成")} {drafts.length} {t("条草稿，选择一条继续")}
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-500">
              {t("草稿视频")} (QG1) · {drafts.length}{t("条")}
            </div>
            {drafts.some((draft) => draft.status === "failed") && (
              <button
                onClick={() => setShowOnlyDone(!showOnlyDone)}
                className="text-xs text-blue-500 hover:underline"
              >
                {showOnlyDone ? t("显示全部") : t("只看可用")}
              </button>
            )}
          </div>
          {drafts.length === 0 && !generating ? (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400">
              {t("点击左侧生成草稿")}
            </div>
          ) : generating && drafts.length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-400">
              <span className="animate-spin">⏳</span>
              {t("Kling 生成中，约 30–60 秒...")}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleDrafts.map((draft, index) => (
                <div
                  key={draft.id}
                  onClick={() =>
                    (draft.status === "done" || draft.status === "selected") && onSelectDraft(draft.id)
                  }
                  className={`flex items-center gap-3 rounded-xl border-2 p-3 transition-all ${
                    selectedDraftId === draft.id
                      ? "border-blue-500 bg-blue-50"
                      : draft.status === "done" || draft.status === "selected"
                        ? "cursor-pointer border-gray-200 hover:border-blue-200"
                        : "cursor-not-allowed border-gray-100 bg-gray-50"
                  }`}
                >
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-200">
                    {draft.thumbnail_url ? (
                      <img src={draft.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    ) : draft.status === "generating" ? (
                      <span className="animate-spin text-lg">⏳</span>
                    ) : (
                      <span className="text-2xl">🎬</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t("草稿")} {index + 1}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      {draft.status === "done"
                        ? `${draft.duration_seconds ?? 5}s · ${draft.model}`
                        : draft.status === "generating"
                          ? t("生成中...")
                          : draft.status === "selected"
                            ? t("已选择")
                            : draft.status}
                    </div>
                  </div>

                  {selectedDraftId === draft.id && (
                    <div className="flex-shrink-0 text-sm font-medium text-blue-600">✓ {t("已选")}</div>
                  )}

                  {draft.video_url && (
                    <a
                      href={draft.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="flex-shrink-0 text-xs text-blue-500 hover:underline"
                    >
                      {t("播放")}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

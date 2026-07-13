"use client";

import { useEffect, useState } from "react";

import { useLanguage } from "@workbench/lib/LanguageContext";
import { normalizeVideoMediaUrl, type VideoDraftItem } from "@workbench/lib/video-workflow";

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
  batchEnabled?: boolean;
  batchVariablesText?: string;
  batchPerVariableCount?: number;
  characterLockEnabled?: boolean;
  characterLockPrompt?: string;
  autoQualityEnabled?: boolean;
  qualityThreshold?: number;
  showOnlyLowScore?: boolean;
  onBatchEnabledChange: (value: boolean) => void;
  onBatchVariablesTextChange: (value: string) => void;
  onBatchPerVariableCountChange: (value: number) => void;
  onCharacterLockEnabledChange: (value: boolean) => void;
  onCharacterLockPromptChange: (value: string) => void;
  onAutoQualityEnabledChange: (value: boolean) => void;
  onQualityThresholdChange: (value: number) => void;
  onShowOnlyLowScoreChange: (value: boolean) => void;
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
  batchEnabled = false,
  batchVariablesText = "",
  batchPerVariableCount = 1,
  characterLockEnabled = false,
  characterLockPrompt = "",
  autoQualityEnabled = true,
  qualityThreshold = 75,
  showOnlyLowScore = false,
  onBatchEnabledChange,
  onBatchVariablesTextChange,
  onBatchPerVariableCountChange,
  onCharacterLockEnabledChange,
  onCharacterLockPromptChange,
  onAutoQualityEnabledChange,
  onQualityThresholdChange,
  onShowOnlyLowScoreChange,
  onCreateEmotion,
  onGenerate,
  onSelectDraft,
}: Props) {
  const { t, lang } = useLanguage();
  const [showOnlyDone, setShowOnlyDone] = useState(false);
  const [sortByQuality, setSortByQuality] = useState(true);
  const [showCustomEmotion, setShowCustomEmotion] = useState(false);
  const [customEmotionLabel, setCustomEmotionLabel] = useState("");
  const [customEmotionValue, setCustomEmotionValue] = useState("");
  const [creatingEmotion, setCreatingEmotion] = useState(false);
  const [expandedQualityIds, setExpandedQualityIds] = useState<Record<string, boolean>>({});
  const doneScopedDrafts = showOnlyDone
    ? drafts.filter((draft) => draft.status === "done" || draft.status === "selected")
    : drafts;
  const filteredDrafts = showOnlyLowScore
    ? doneScopedDrafts.filter((draft) => typeof draft.qualityScore === "number" && draft.qualityScore < qualityThreshold)
    : doneScopedDrafts;
  const visibleDrafts = sortByQuality
    ? [...filteredDrafts].sort((a, b) => {
        const aScore = typeof a.qualityScore === "number" ? a.qualityScore : -1;
        const bScore = typeof b.qualityScore === "number" ? b.qualityScore : -1;
        if (bScore !== aScore) return bScore - aScore;
        return a.id > b.id ? 1 : -1;
      })
    : filteredDrafts;
  const emotionPresets = emotionOptions?.length
    ? emotionOptions.map((item) => ({ zh: item.label_zh, en: item.value, emoji: "" }))
    : EMOTION_PRESETS;
  const batchLineCount = batchVariablesText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const estimatedBatchCount = batchEnabled ? Math.max(batchLineCount, 1) * Math.max(batchPerVariableCount, 1) : draftCount;
  const scoredDrafts = drafts.filter((draft) => typeof draft.qualityScore === "number");
  const averageQualityScore = scoredDrafts.length
    ? Math.round(
        scoredDrafts.reduce((sum, draft) => sum + (draft.qualityScore as number), 0) / scoredDrafts.length,
      )
    : null;
  const lowScoreCount = drafts.filter(
    (draft) => typeof draft.qualityScore === "number" && draft.qualityScore < qualityThreshold,
  ).length;

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

  const toggleQualityDetail = (draftId: string) => {
    setExpandedQualityIds((prev) => ({ ...prev, [draftId]: !prev[draftId] }));
  };

  const handleAutoPickBest = () => {
    const candidates = drafts.filter(
      (draft) => (draft.status === "done" || draft.status === "selected") && Boolean(draft.video_url),
    );
    if (!candidates.length) return;
    const best = [...candidates].sort((a, b) => {
      const aScore = typeof a.qualityScore === "number" ? a.qualityScore : -1;
      const bScore = typeof b.qualityScore === "number" ? b.qualityScore : -1;
      if (bScore !== aScore) return bScore - aScore;
      return a.id > b.id ? 1 : -1;
    })[0];
    onSelectDraft(best.id);
  };

  useEffect(() => {
    if (!autoQualityEnabled) return;
    setExpandedQualityIds((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const draft of drafts) {
        if (typeof draft.qualityScore !== "number") continue;
        if (draft.qualityScore >= qualityThreshold) continue;
        if (draft.id in next) continue;
        next[draft.id] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [autoQualityEnabled, drafts, qualityThreshold]);

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
                src={normalizeVideoMediaUrl(firstFrameUrl)}
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

          <div className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">批量变量生成</div>
                <div className="text-xs text-gray-400">每行一个变量词，自动批量出草稿</div>
              </div>
              <button
                onClick={() => onBatchEnabledChange(!batchEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  batchEnabled ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    batchEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {batchEnabled && (
              <>
                <textarea
                  value={batchVariablesText}
                  onChange={(event) => onBatchVariablesTextChange(event.target.value)}
                  placeholder={"变量示例：\n雨中奔跑\n城市夜景\n追光镜头"}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
                <div>
                  <div className="mb-1 text-xs text-gray-500">每个变量生成数量</div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((count) => (
                      <button
                        key={count}
                        onClick={() => onBatchPerVariableCountChange(count)}
                        className={`flex-1 rounded-lg border py-1.5 text-xs ${
                          batchPerVariableCount === count
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-500"
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-blue-600">预计生成 {estimatedBatchCount} 条草稿</div>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">角色一致性锁定</div>
                <div className="text-xs text-gray-400">固定角色脸型/服饰/色板，减少跑偏</div>
              </div>
              <button
                onClick={() => onCharacterLockEnabledChange(!characterLockEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  characterLockEnabled ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    characterLockEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {characterLockEnabled && (
              <textarea
                value={characterLockPrompt}
                onChange={(event) => onCharacterLockPromptChange(event.target.value)}
                placeholder="Keep same character identity, outfit, and facial traits..."
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">自动质检评分</div>
                <div className="text-xs text-gray-400">自动打分并辅助筛选可用草稿</div>
              </div>
              <button
                onClick={() => onAutoQualityEnabledChange(!autoQualityEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoQualityEnabled ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    autoQualityEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {autoQualityEnabled && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                  <span>通过阈值</span>
                  <span>{qualityThreshold}</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={95}
                  value={qualityThreshold}
                  onChange={(event) => onQualityThresholdChange(Number(event.target.value))}
                  className="w-full"
                />
              </div>
            )}
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-gray-500">
              {t("草稿视频")} (QG1) · {drafts.length}{t("条")}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {drafts.some((draft) => draft.status === "failed") && (
                <button
                  onClick={() => setShowOnlyDone(!showOnlyDone)}
                  className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
                >
                  {showOnlyDone ? t("显示全部") : t("只看可用")}
                </button>
              )}
              <button
                onClick={() => setSortByQuality((prev) => !prev)}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  sortByQuality
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                按质检排序
              </button>
              <button
                onClick={() => onShowOnlyLowScoreChange(!showOnlyLowScore)}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  showOnlyLowScore
                    ? "border-amber-400 bg-amber-50 text-amber-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                仅看待优化
              </button>
              <button
                onClick={handleAutoPickBest}
                className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                自动选最佳
              </button>
            </div>
          </div>
          {averageQualityScore !== null && (
            <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
              平均分 {averageQualityScore} · 低于阈值 {lowScoreCount} 条
            </div>
          )}
          {drafts.length === 0 && !generating ? (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400">
              {t("点击左侧生成草稿")}
            </div>
          ) : generating && drafts.length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-400">
              <span className="animate-spin">⏳</span>
              {t("Kling 生成中，约 30–60 秒...")}
            </div>
          ) : visibleDrafts.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
              当前筛选条件下暂无草稿
            </div>
          ) : (
            <div className="space-y-2">
              {visibleDrafts.map((draft, index) => (
                <div
                  key={draft.id}
                  onClick={() =>
                    (draft.status === "done" || draft.status === "selected") && onSelectDraft(draft.id)
                  }
                  className={`rounded-xl border-2 p-3 transition-all ${
                    selectedDraftId === draft.id
                      ? "border-blue-500 bg-blue-50"
                      : draft.status === "done" || draft.status === "selected"
                        ? "cursor-pointer border-gray-200 hover:border-blue-200"
                        : "cursor-not-allowed border-gray-100 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-200">
                      {draft.thumbnail_url ? (
                        <img src={normalizeVideoMediaUrl(draft.thumbnail_url)} alt="" className="h-full w-full object-cover" />
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
                      {typeof draft.qualityScore === "number" && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              draft.qualityScore >= 88
                                ? "bg-green-100 text-green-700"
                                : draft.qualityScore >= 76
                                  ? "bg-blue-100 text-blue-700"
                                  : draft.qualityScore >= 60
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-red-100 text-red-700"
                            }`}
                          >
                            质检 {draft.qualityScore} · {draft.qualityGrade ?? "C"}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {draft.qualityModelSource === "model" ? "模型评分" : "本地评分"}
                          </span>
                          {autoQualityEnabled && draft.qualityScore < qualityThreshold ? (
                            <span className="text-[11px] text-red-500">低于阈值</span>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      {selectedDraftId === draft.id && (
                        <div className="text-sm font-medium text-blue-600">✓ {t("已选")}</div>
                      )}

                      {typeof draft.qualityScore === "number" && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleQualityDetail(draft.id);
                          }}
                          className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-white"
                        >
                          {expandedQualityIds[draft.id] ? "收起质检" : "质检详情"}
                        </button>
                      )}

                      {draft.video_url && (
                        <a
                          href={draft.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {t("播放")}
                        </a>
                      )}
                    </div>
                  </div>

                  {expandedQualityIds[draft.id] && typeof draft.qualityScore === "number" && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-white/80 p-3">
                      <div className="mb-2 text-xs font-medium text-gray-600">质检评分详情（四维）</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                        <div className="rounded bg-gray-50 px-2 py-1">
                          一致性：{draft.qualityDimensions?.consistency ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          动作流畅：{draft.qualityDimensions?.motion ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          画质清晰：{draft.qualityDimensions?.visual ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          文本洁净：{draft.qualityDimensions?.textClean ?? "--"}
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-gray-600">
                        <span className="font-medium">原因：</span>
                        {draft.qualityReasons?.length ? draft.qualityReasons.join("；") : "暂无"}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600">
                        <span className="font-medium">建议：</span>
                        {draft.qualitySuggestions?.length ? draft.qualitySuggestions.join("；") : "暂无"}
                      </div>
                    </div>
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

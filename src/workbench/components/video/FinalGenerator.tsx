"use client";

import { useEffect, useState } from "react";

import { useLanguage } from "@workbench/lib/LanguageContext";
import { normalizeVideoMediaUrl, type VideoDraftItem } from "@workbench/lib/video-workflow";

interface Props {
  firstFrameUrl?: string;
  motionPrompt?: string;
  aspectRatio?: string;
  finals: VideoDraftItem[];
  selectedFinalId?: string;
  generating?: boolean;
  availableModels?: { id: number; name: string; model_name: string }[];
  modelConfigId?: number;
  duration?: number;
  sound?: boolean;
  qualityThreshold?: number;
  autoQualityEnabled?: boolean;
  showOnlyLowScore?: boolean;
  onModelChange: (id: number) => void;
  onAspectRatioChange: (value: string) => void;
  onSoundChange: (value: boolean) => void;
  onShowOnlyLowScoreChange: (value: boolean) => void;
  onGenerate: () => void;
  onSelectFinal: (id: string) => void;
}

export default function FinalGenerator({
  firstFrameUrl,
  motionPrompt,
  aspectRatio = "9:16",
  finals,
  selectedFinalId,
  generating = false,
  availableModels = [],
  modelConfigId,
  duration = 5,
  sound = false,
  qualityThreshold = 75,
  autoQualityEnabled = true,
  showOnlyLowScore = false,
  onModelChange,
  onAspectRatioChange,
  onSoundChange,
  onShowOnlyLowScoreChange,
  onGenerate,
  onSelectFinal,
}: Props) {
  const { t } = useLanguage();
  const [sortByQuality, setSortByQuality] = useState(true);
  const displayFinals = finals.filter((final) => !final.operation);
  const [expandedQualityIds, setExpandedQualityIds] = useState<Record<string, boolean>>({});
  const filteredFinals = showOnlyLowScore
    ? displayFinals.filter((final) => typeof final.qualityScore === "number" && final.qualityScore < qualityThreshold)
    : displayFinals;
  const visibleFinals = sortByQuality
    ? [...filteredFinals].sort((a, b) => {
        const aScore = typeof a.qualityScore === "number" ? a.qualityScore : -1;
        const bScore = typeof b.qualityScore === "number" ? b.qualityScore : -1;
        if (bScore !== aScore) return bScore - aScore;
        return a.id > b.id ? 1 : -1;
      })
    : filteredFinals;
  const scoredFinals = displayFinals.filter((final) => typeof final.qualityScore === "number");
  const averageQualityScore = scoredFinals.length
    ? Math.round(
        scoredFinals.reduce((sum, final) => sum + (final.qualityScore as number), 0) / scoredFinals.length,
      )
    : null;
  const lowScoreCount = displayFinals.filter(
    (final) => typeof final.qualityScore === "number" && final.qualityScore < qualityThreshold,
  ).length;

  useEffect(() => {
    if (!autoQualityEnabled) return;
    setExpandedQualityIds((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const final of displayFinals) {
        if (typeof final.qualityScore !== "number") continue;
        if (final.qualityScore >= qualityThreshold) continue;
        if (final.id in next) continue;
        next[final.id] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [autoQualityEnabled, displayFinals, qualityThreshold]);

  const handleAutoPickBest = () => {
    const candidates = displayFinals.filter((final) => final.status === "done" && Boolean(final.video_url));
    if (!candidates.length) return;
    const best = [...candidates].sort((a, b) => {
      const aScore = typeof a.qualityScore === "number" ? a.qualityScore : -1;
      const bScore = typeof b.qualityScore === "number" ? b.qualityScore : -1;
      if (bScore !== aScore) return bScore - aScore;
      return a.id > b.id ? 1 : -1;
    })[0];
    onSelectFinal(best.id);
  };

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-gray-900">{t("精品生成")}</h2>
      <p className="mb-5 text-sm text-gray-500">{t("精品生成说明")}</p>

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

          {motionPrompt && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="mb-1 text-xs font-medium text-gray-500">{t("动作描述")}</div>
              <div className="text-sm text-gray-700">{motionPrompt}</div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-gray-500">{t("精品模型")}</div>
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

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500">{t("画面比例")}</div>
            <div className="flex gap-2">
              {[
                { label: "TikTok / Reels  9:16", value: "9:16" },
                { label: "Facebook  16:9", value: "16:9" },
                { label: "1:1", value: "1:1" },
              ].map((ratio) => (
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

          <div>
            <div className="mb-1 text-xs font-medium text-gray-500">{t("视频时长")}</div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {duration ?? 5}s · {t("与草稿一致，不可修改")}
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
            disabled={generating || !modelConfigId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <>
                <span className="animate-spin">⏳</span>
                {t("生成中...")}
              </>
            ) : (
              <>
                <span>✦</span>
                {displayFinals.length > 0 ? t("重新生成") : t("开始精品生成")}
              </>
            )}
          </button>

          {displayFinals.length > 0 && (
            <p className="text-center text-xs text-gray-400">
              {t("已生成")} {displayFinals.filter((final) => final.status === "done").length} {t("条终稿，选择最佳一条")}
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-gray-500">{t("终稿视频")} (QG2)</div>
            <div className="flex flex-wrap items-center gap-1.5">
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
          {displayFinals.length === 0 && !generating ? (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400">
              {t("点击左侧开始精品生成")}
            </div>
          ) : generating && displayFinals.filter((final) => final.status === "done").length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-400">
              <span className="animate-spin">⏳</span>
              {t("精品生成中，约 1–3 分钟...")}
            </div>
          ) : visibleFinals.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
              当前筛选条件下暂无终稿
            </div>
          ) : (
            <div className="space-y-2">
              {visibleFinals.map((final, index) => (
                <div
                  key={final.id}
                  onClick={() => final.status === "done" && onSelectFinal(final.id)}
                  className={`rounded-xl border-2 p-3 transition-all ${
                    selectedFinalId === final.id
                      ? "border-blue-500 bg-blue-50"
                      : final.status === "done"
                        ? "cursor-pointer border-gray-200 hover:border-blue-200"
                        : "cursor-not-allowed border-gray-100 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-200">
                      {final.thumbnail_url ? (
                        <img src={normalizeVideoMediaUrl(final.thumbnail_url)} alt="" className="h-full w-full object-cover" />
                      ) : final.status === "generating" ? (
                        <span className="animate-spin text-lg">⏳</span>
                      ) : (
                        <span className="text-2xl">✦</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-700">
                        {t("终稿")} {index + 1}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {final.status === "done"
                          ? `${final.duration_seconds ?? duration}s · ${final.model}`
                          : final.status === "generating"
                            ? t("生成中...")
                            : final.status === "failed"
                              ? t("生成失败")
                              : final.status}
                      </div>
                      {typeof final.qualityScore === "number" && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              final.qualityScore >= 88
                                ? "bg-green-100 text-green-700"
                                : final.qualityScore >= 76
                                  ? "bg-blue-100 text-blue-700"
                                  : final.qualityScore >= 60
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-red-100 text-red-700"
                            }`}
                          >
                            质检 {final.qualityScore} · {final.qualityGrade ?? "C"}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {final.qualityModelSource === "model" ? "模型评分" : "本地评分"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {selectedFinalId === final.id && (
                        <div className="text-sm font-medium text-blue-600">✓ {t("已选")}</div>
                      )}
                      {typeof final.qualityScore === "number" && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedQualityIds((prev) => ({ ...prev, [final.id]: !prev[final.id] }));
                          }}
                          className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-white"
                        >
                          {expandedQualityIds[final.id] ? "收起质检" : "质检详情"}
                        </button>
                      )}
                      {final.video_url && (
                        <a
                          href={final.video_url}
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
                  {expandedQualityIds[final.id] && typeof final.qualityScore === "number" && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-white/80 p-3">
                      <div className="mb-2 text-xs font-medium text-gray-600">质检评分详情（四维）</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                        <div className="rounded bg-gray-50 px-2 py-1">
                          一致性：{final.qualityDimensions?.consistency ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          动作流畅：{final.qualityDimensions?.motion ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          画质清晰：{final.qualityDimensions?.visual ?? "--"}
                        </div>
                        <div className="rounded bg-gray-50 px-2 py-1">
                          文本洁净：{final.qualityDimensions?.textClean ?? "--"}
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-gray-600">
                        <span className="font-medium">原因：</span>
                        {final.qualityReasons?.length ? final.qualityReasons.join("；") : "暂无"}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600">
                        <span className="font-medium">建议：</span>
                        {final.qualitySuggestions?.length ? final.qualitySuggestions.join("；") : "暂无"}
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

"use client";

import { saveFileWithPicker } from "@/lib/save-file-with-picker";
import { useEffect, useState } from "react";

import { workbenchFetch } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { normalizeVideoMediaUrl } from "@workbench/lib/video-workflow";

function buildDownloadFileName(taskName?: string, draftId?: string): string {
  const base =
    (taskName || "final_video")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "final_video";
  const suffix = draftId ? `_${draftId.slice(0, 8)}` : "";
  return `${base}${suffix}.mp4`;
}

interface Props {
  jobId?: string;
  finalDraftId?: string;
  finalVideoUrl?: string;
  firstFrameUrl?: string;
  taskName?: string;
  aspectRatio?: string;
  duration?: number;
  coverUrl?: string;
  multiAspectRatios?: string[];
  multiAspectVariants?: Array<{
    ratio: string;
    status: "idle" | "pending" | "done" | "failed";
    videoUrl?: string;
  }>;
  generatingMultiAspect?: boolean;
  storyboardPrompt?: string;
  storyboardImages?: string[];
  storyboardNotice?: string;
  storyboardCount?: number;
  storyboardStyle?: string;
  storyboardStyleOptions?: Array<{ value: string; label: string }>;
  storyboardLogFilter?: "all" | "auto" | "manual";
  storyboardLogLimit?: number;
  storyboardLogFinalIdKeyword?: string;
  storyboardCsvExportMode?: "filtered" | "all";
  storyboardLastTriggerSource?: "auto" | "manual";
  storyboardLastTriggeredAt?: string;
  storyboardOperationLogs?: Array<{
    id: string;
    actor: string;
    triggerSource: "auto" | "manual";
    triggeredAt: string;
    finalDraftId: string;
    resultCount: number;
    status: "success" | "failed";
  }>;
  generatingStoryboard?: boolean;
  storyboardError?: string;
  autoStoryboardAfterArchive?: boolean;
  onMultiAspectRatiosChange?: (ratios: string[]) => void;
  onGenerateMultiAspect?: () => void;
  onStoryboardPromptChange?: (value: string) => void;
  onStoryboardCountChange?: (value: number) => void;
  onStoryboardStyleChange?: (value: string) => void;
  onStoryboardLogFilterChange?: (value: "all" | "auto" | "manual") => void;
  onStoryboardLogLimitChange?: (value: number) => void;
  onStoryboardLogFinalIdKeywordChange?: (value: string) => void;
  onStoryboardCsvExportModeChange?: (value: "filtered" | "all") => void;
  onGenerateStoryboard?: () => void;
  onResetStoryboardConfig?: () => void;
  onClearStoryboard?: () => void;
  onUndoClearStoryboard?: () => void;
  canUndoStoryboardClear?: boolean;
  onAutoStoryboardAfterArchiveChange?: (value: boolean) => void;
  onFeedback?: (rating: "good" | "bad") => void;
  onArchive: () => void;
  archiving?: boolean;
  archived?: boolean;
}

export default function ExportArchiver({
  jobId,
  finalDraftId,
  finalVideoUrl,
  firstFrameUrl,
  taskName,
  aspectRatio = "9:16",
  duration = 5,
  coverUrl,
  multiAspectRatios = [],
  multiAspectVariants = [],
  generatingMultiAspect = false,
  storyboardPrompt = "",
  storyboardImages = [],
  storyboardNotice,
  storyboardCount = 8,
  storyboardStyle = "cinematic_ad",
  storyboardStyleOptions,
  storyboardLogFilter = "all",
  storyboardLogLimit = 10,
  storyboardLogFinalIdKeyword = "",
  storyboardCsvExportMode = "filtered",
  storyboardLastTriggerSource = "manual",
  storyboardLastTriggeredAt = "",
  storyboardOperationLogs = [],
  generatingStoryboard = false,
  storyboardError,
  autoStoryboardAfterArchive = true,
  onMultiAspectRatiosChange,
  onGenerateMultiAspect,
  onStoryboardPromptChange,
  onStoryboardCountChange,
  onStoryboardStyleChange,
  onStoryboardLogFilterChange,
  onStoryboardLogLimitChange,
  onStoryboardLogFinalIdKeywordChange,
  onStoryboardCsvExportModeChange,
  onGenerateStoryboard,
  onResetStoryboardConfig,
  onClearStoryboard,
  onUndoClearStoryboard,
  canUndoStoryboardClear = false,
  onAutoStoryboardAfterArchiveChange,
  onFeedback,
  onArchive,
  archiving = false,
  archived = false,
}: Props) {
  const { t } = useLanguage();
  const ratioOptions = ["9:16", "16:9", "1:1"];
  const storyboardCountOptions = [6, 8, 10, 12];
  const fallbackStyleOptions = [
    { value: "cinematic_ad", label: "电影广告风" },
    { value: "social_short", label: "社媒短视频风" },
    { value: "documentary_real", label: "纪实写实风" },
  ];
  const effectiveStoryboardStyleOptions =
    storyboardStyleOptions && storyboardStyleOptions.length ? storyboardStyleOptions : fallbackStyleOptions;

  const triggerSourceLabel = storyboardLastTriggerSource === "auto" ? "自动触发" : "手动触发";
  const formattedTriggeredAt = (() => {
    if (!storyboardLastTriggeredAt) return "";
    const dt = new Date(storyboardLastTriggeredAt);
    return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleString();
  })();
  const sortedStoryboardLogs = [...storyboardOperationLogs].sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1));
  const [confirmingClearStoryboard, setConfirmingClearStoryboard] = useState(false);
  const normalizedKeyword = storyboardLogFinalIdKeyword.trim().toLowerCase();
  const filteredStoryboardLogs = sortedStoryboardLogs.filter((log) => {
    if (storyboardLogFilter !== "all" && log.triggerSource !== storyboardLogFilter) return false;
    if (!normalizedKeyword) return true;
    return log.finalDraftId.toLowerCase().includes(normalizedKeyword);
  });
  const visibleStoryboardLogs = filteredStoryboardLogs.slice(0, storyboardLogLimit);

  useEffect(() => {
    if (!confirmingClearStoryboard) return;
    const timer = setTimeout(() => setConfirmingClearStoryboard(false), 4500);
    return () => clearTimeout(timer);
  }, [confirmingClearStoryboard]);

  const clearStoryboardWithConfirm = () => {
    if (!onClearStoryboard) return;
    if (!confirmingClearStoryboard) {
      setConfirmingClearStoryboard(true);
      return;
    }
    setConfirmingClearStoryboard(false);
    onClearStoryboard();
  };

  const exportStoryboardLogsCsv = () => {
    const logsForExport = storyboardCsvExportMode === "all" ? sortedStoryboardLogs : filteredStoryboardLogs;
    if (!logsForExport.length) return;
    const rows = [
      ["触发时间", "触发方式", "触发人", "终稿ID", "结果数", "状态"],
      ...logsForExport.map((log) => {
        const ts = new Date(log.triggeredAt);
        const timeLabel = Number.isNaN(ts.getTime()) ? log.triggeredAt : ts.toLocaleString();
        return [
          timeLabel,
          log.triggerSource === "auto" ? "自动" : "手动",
          log.actor,
          log.finalDraftId || "-",
          String(log.resultCount),
          log.status === "success" ? "成功" : "失败",
        ];
      }),
    ];
    const escapeCell = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTask = (taskName || "storyboard_logs").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    link.href = url;
    link.download = `${safeTask}_storyboard_logs.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = async () => {
    if (!finalVideoUrl) return;

    const downloadUrl =
      jobId && finalDraftId
        ? `/api/video/jobs/${jobId}/download?draft_id=${finalDraftId}`
        : null;

    if (!downloadUrl) {
      window.open(finalVideoUrl, "_blank");
      return;
    }

    try {
      const response = await workbenchFetch(downloadUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const fileName = buildDownloadFileName(taskName, finalDraftId);
      const saved = await saveFileWithPicker(blob, fileName, [
        { description: "MP4 Video", accept: { "video/mp4": [".mp4"] } },
      ]);
      if (!saved) return;
    } catch (error) {
      console.error("Download error:", error);
      alert(t("视频下载失败，请稍后重试"));
    }
  };

  const handleDownloadCover = async () => {
    if (!coverUrl) return;
    try {
      const response = await fetch(coverUrl);
      if (!response.ok) throw new Error(`Cover download failed (${response.status})`);
      const blob = await response.blob();
      const fileName = `${buildDownloadFileName(taskName, finalDraftId).replace(/\.mp4$/i, "")}_cover.png`;
      await saveFileWithPicker(blob, fileName, [{ description: "PNG Image", accept: { "image/png": [".png"] } }]);
    } catch (error) {
      console.error("cover download error:", error);
      alert("封面下载失败，请稍后重试");
    }
  };

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-gray-900">{t("导出归档")}</h2>
      <p className="mb-5 text-sm text-gray-500">{t("导出归档说明")}</p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 text-xs font-medium text-gray-500">{t("任务信息")}</div>
            <div className="flex items-center gap-3">
              {firstFrameUrl && (
                <img
                  src={normalizeVideoMediaUrl(firstFrameUrl)}
                  alt=""
                  className="h-12 w-12 rounded-lg border border-gray-200 object-cover"
                />
              )}
              <div>
                <div className="text-sm font-medium text-gray-800">{taskName || t("未命名任务")}</div>
                <div className="mt-0.5 text-xs text-gray-400">
                  {finalVideoUrl ? t("终稿视频已就绪") : t("终稿视频未生成")}
                </div>
              </div>
            </div>
          </div>

          {sortedStoryboardLogs.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-gray-500">分镜生成操作日志</div>
                <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-[11px]">
                  {[
                    { key: "filtered", label: "当前筛选导出" },
                    { key: "all", label: "全量导出" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        onStoryboardCsvExportModeChange?.(item.key as "filtered" | "all")
                      }
                      className={`rounded px-2 py-0.5 ${
                        storyboardCsvExportMode === item.key ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-[11px]">
                  {[
                    { key: "all", label: "全部" },
                    { key: "auto", label: "仅看自动" },
                    { key: "manual", label: "仅看手动" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onStoryboardLogFilterChange?.(item.key as "all" | "auto" | "manual")}
                      className={`rounded px-2 py-0.5 ${
                        storyboardLogFilter === item.key ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <input
                  value={storyboardLogFinalIdKeyword}
                  onChange={(event) => onStoryboardLogFinalIdKeywordChange?.(event.target.value)}
                  placeholder="按终稿ID快速过滤"
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 outline-none"
                />
                <div className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <span>最多显示</span>
                  <select
                    value={storyboardLogLimit}
                    onChange={(event) => onStoryboardLogLimitChange?.(Number(event.target.value) || 10)}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 outline-none"
                  >
                    {[10, 20, 50].map((limit) => (
                      <option key={limit} value={limit}>
                        {limit}
                      </option>
                    ))}
                  </select>
                  <span>条</span>
                </div>
                <button
                  type="button"
                  onClick={exportStoryboardLogsCsv}
                  className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50"
                >
                  导出 CSV
                </button>
              </div>
              <div className="space-y-1.5">
                {visibleStoryboardLogs.map((log) => {
                  const ts = new Date(log.triggeredAt);
                  const timeLabel = Number.isNaN(ts.getTime()) ? "-" : ts.toLocaleString();
                  const sourceLabel = log.triggerSource === "auto" ? "自动" : "手动";
                  const statusLabel = log.status === "success" ? "成功" : "失败";
                  return (
                    <div key={log.id} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-600">
                      <div className="flex items-center justify-between gap-2">
                        <span>{log.actor}</span>
                        <span className={log.status === "success" ? "text-green-600" : "text-red-500"}>{statusLabel}</span>
                      </div>
                      <div className="mt-0.5 text-gray-500">
                        {sourceLabel}触发 · {timeLabel} · 结果 {log.resultCount} 张
                      </div>
                      <div className="mt-0.5 text-gray-500">
                        终稿ID：{log.finalDraftId || "-"}
                      </div>
                    </div>
                  );
                })}
                {visibleStoryboardLogs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-200 bg-white px-2 py-2 text-[11px] text-gray-400">
                    当前筛选条件下暂无日志
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 text-xs font-medium text-gray-500">{t("视频规格")}</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎬</span>
              <div>
                <div className="text-sm font-medium text-gray-800">
                  {aspectRatio === "9:16"
                    ? "TikTok / Reels"
                    : aspectRatio === "16:9"
                      ? "Facebook"
                      : "1:1"}{" "}
                  · {aspectRatio}
                </div>
                <div className="text-xs text-gray-400">H.264 · {duration ?? 5}s</div>
              </div>
            </div>
          </div>

          {finalVideoUrl && (
            <div>
              <button
                onClick={() => {
                  void handleDownload();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700"
              >
                <span>⬇</span>
                {t("下载视频")}
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">{t("下载视频说明")}</p>
            </div>
          )}

          {coverUrl && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">自动封面</div>
              <div className="flex items-center gap-3">
                <img src={coverUrl} alt="cover" className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
                <button
                  onClick={() => {
                    void handleDownloadCover();
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-white"
                >
                  下载封面
                </button>
              </div>
            </div>
          )}

          {onGenerateMultiAspect && onMultiAspectRatiosChange && (
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">多比例导出</div>
              <div className="mb-3 flex flex-wrap gap-2">
                {ratioOptions.map((ratio) => {
                  const checked = multiAspectRatios.includes(ratio);
                  return (
                    <label
                      key={ratio}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                        checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...new Set([...multiAspectRatios, ratio])]
                            : multiAspectRatios.filter((item) => item !== ratio);
                          onMultiAspectRatiosChange(next);
                        }}
                        className="hidden"
                      />
                      {ratio}
                    </label>
                  );
                })}
              </div>
              <button
                onClick={onGenerateMultiAspect}
                disabled={generatingMultiAspect || !multiAspectRatios.length}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generatingMultiAspect ? "生成多比例中..." : "生成多比例版本"}
              </button>
              {multiAspectVariants.length > 0 && (
                <div className="mt-3 space-y-2">
                  {multiAspectVariants.map((variant) => (
                    <div key={variant.ratio} className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1.5">
                      <div className="text-xs text-gray-600">
                        {variant.ratio} ·{" "}
                        {variant.status === "done"
                          ? "已完成"
                          : variant.status === "pending"
                            ? "生成中"
                            : variant.status === "failed"
                              ? "失败"
                              : "待生成"}
                      </div>
                      {variant.videoUrl ? (
                        <a
                          href={variant.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                        >
                          下载
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {onGenerateStoryboard && (
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">关键分镜工具</div>
              <p className="mb-2 text-xs text-gray-400">
                基于当前成片和参考图，一键生成可复用的关键分镜图，方便复盘和二次创作。
              </p>
              {onStoryboardPromptChange && (
                <textarea
                  value={storyboardPrompt}
                  onChange={(event) => onStoryboardPromptChange(event.target.value)}
                  rows={3}
                  placeholder="分镜导语（可选）：例如强调开场特写、产品特写、结尾转场等"
                  className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-blue-400"
                />
              )}
              {formattedTriggeredAt ? (
                <div className="mb-2 text-[11px] text-gray-500">
                  最近触发：{triggerSourceLabel} · {formattedTriggeredAt}
                </div>
              ) : null}
              {storyboardNotice ? (
                <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  {storyboardNotice}
                </div>
              ) : null}
              {onStoryboardCountChange && (
                <div className="mb-2">
                  <div className="mb-1 text-[11px] text-gray-500">分镜张数</div>
                  <div className="flex flex-wrap gap-1.5">
                    {storyboardCountOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => onStoryboardCountChange(count)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          storyboardCount === count
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-500"
                        }`}
                      >
                        {count} 张
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {onStoryboardStyleChange && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                    <span>分镜风格</span>
                    {onResetStoryboardConfig ? (
                      <button
                        type="button"
                        onClick={onResetStoryboardConfig}
                        className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
                      >
                        恢复默认
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {effectiveStoryboardStyleOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => onStoryboardStyleChange(item.value)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          storyboardStyle === item.value
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-500"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={onGenerateStoryboard}
                disabled={generatingStoryboard || !finalVideoUrl}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generatingStoryboard ? "生成关键分镜中..." : "生成关键分镜"}
              </button>
              {storyboardError ? <div className="mt-2 text-xs text-red-500">{storyboardError}</div> : null}
              {onAutoStoryboardAfterArchiveChange && (
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={autoStoryboardAfterArchive}
                    onChange={(event) => onAutoStoryboardAfterArchiveChange(event.target.checked)}
                  />
                  归档成功后自动触发关键分镜
                </label>
              )}
              {storyboardImages.length > 0 ? (
                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-500">已生成 {storyboardImages.length} 张分镜</div>
                    {onClearStoryboard ? (
                      <div className="flex items-center gap-1.5">
                        {onUndoClearStoryboard && canUndoStoryboardClear ? (
                          <button
                            type="button"
                            onClick={onUndoClearStoryboard}
                            className="rounded-md border border-emerald-200 px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-50"
                          >
                            撤销清空
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={clearStoryboardWithConfirm}
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            confirmingClearStoryboard
                              ? "border-red-300 bg-red-50 text-red-600"
                              : "border-gray-200 text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {confirmingClearStoryboard ? "再次点击确认清空" : "清空本次分镜"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {storyboardImages.map((url, index) => (
                      <a
                        key={`${url}-${index}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                      >
                        <img src={url} alt={`storyboard-${index + 1}`} className="h-28 w-full object-cover" />
                        <div className="px-2 py-1 text-[11px] text-blue-500 group-hover:underline">
                          分镜 {index + 1} · 打开
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {onFeedback && (
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">效果回流</div>
              <div className="flex gap-2">
                <button
                  onClick={() => onFeedback("good")}
                  className="flex-1 rounded-lg border border-green-200 bg-green-50 py-1.5 text-xs text-green-700"
                >
                  👍 效果好
                </button>
                <button
                  onClick={() => onFeedback("bad")}
                  className="flex-1 rounded-lg border border-red-200 bg-red-50 py-1.5 text-xs text-red-700"
                >
                  👎 待优化
                </button>
              </div>
            </div>
          )}

          <button
            onClick={onArchive}
            disabled={archiving || archived || !finalVideoUrl}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all ${
              archived
                ? "border border-green-200 bg-green-100 text-green-700"
                : "border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
            }`}
          >
            {archiving ? (
              <>
                <span className="animate-spin">⏳</span>
                {t("归档中...")}
              </>
            ) : archived ? (
              <>
                <span>✓</span>
                {t("已归档到成品库")}
              </>
            ) : (
              <>
                <span>📦</span>
                {t("归档到成品库")}
              </>
            )}
          </button>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-gray-500">{t("最终视频")}</div>
          {finalVideoUrl ? (
            <video
              src={finalVideoUrl}
              controls
              className="w-full rounded-xl border border-gray-200 bg-black"
              style={{ maxHeight: "400px" }}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 px-4 text-center text-sm text-gray-400">
              <div>
                <div className="mb-2 text-3xl">🎬</div>
                <div>{t("请先完成前面的步骤")}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

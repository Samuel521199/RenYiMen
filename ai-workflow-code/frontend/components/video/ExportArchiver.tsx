"use client";

import { useLanguage } from "@/lib/LanguageContext";

interface Props {
  jobId?: string;
  finalDraftId?: string;
  finalVideoUrl?: string;
  firstFrameUrl?: string;
  taskName?: string;
  aspectRatio?: string;
  duration?: number;
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
  onArchive,
  archiving = false,
  archived = false,
}: Props) {
  const { t } = useLanguage();

  const handleDownload = async () => {
    if (!finalVideoUrl) return;
    const token = localStorage.getItem("token") ?? "";

    const downloadUrl =
      jobId && finalDraftId
        ? `/api/video/jobs/${jobId}/download?draft_id=${finalDraftId}`
        : null;

    if (!downloadUrl) {
      window.open(finalVideoUrl, "_blank");
      return;
    }

    try {
      const response = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "final_video.mp4";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error("Download error:", error);
      window.open(finalVideoUrl, "_blank");
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
                  src={firstFrameUrl}
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
            <button
              onClick={() => {
                void handleDownload();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700"
            >
              <span>⬇</span>
              {t("下载视频")}
            </button>
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

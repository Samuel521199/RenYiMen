"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

interface VideoJob {
  id: string;
  first_frame_url?: string | null;
  export_url?: string | null;
  notes?: string | null;
  created_at?: string | null;
  status?: string | null;
}

function toImageUrl(url?: string | null) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPreviewVideoUrl(job: VideoJob) {
  if (job.export_url) return toImageUrl(job.export_url);
  return `${API_BASE}/api/video/jobs/${job.id}/download`;
}

function normalizeJobs(input: unknown): VideoJob[] {
  if (!Array.isArray(input)) return [];

  return input
    .map<VideoJob | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      if (!id) return null;
      return {
        id,
        first_frame_url: typeof record.first_frame_url === "string" ? record.first_frame_url : null,
        export_url: typeof record.export_url === "string" ? record.export_url : null,
        notes: typeof record.notes === "string" ? record.notes : null,
        created_at: typeof record.created_at === "string" ? record.created_at : null,
        status: typeof record.status === "string" ? record.status : null,
      };
    })
    .filter((item): item is VideoJob => item !== null);
}

export default function VideoGalleryPage() {
  const { lang } = useLanguage();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewJob, setPreviewJob] = useState<VideoJob | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");

    apiGet("/api/video/jobs/list?status=completed&page=1&page_size=50")
      .then((res) => {
        if (cancelled) return;
        if (res?.code !== 0) {
          setJobs([]);
          setError(lang === "zh" ? "视频成品库加载失败" : "Failed to load video gallery");
          return;
        }
        const payload = res.data;
        const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
        setJobs(normalizeJobs(items).filter((job) => job.status === "completed"));
      })
      .catch(() => {
        if (cancelled) return;
        setJobs([]);
        setError(lang === "zh" ? "视频成品库加载失败" : "Failed to load video gallery");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lang]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={lang === "zh" ? "视频成品库" : "Video Gallery"}
        description={
          lang === "zh"
            ? "查看已完成的视频任务，点击卡片可回到对应工作流继续处理。"
            : "Browse completed video jobs and jump back into the workflow from any card."
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/gallery"
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:border-emerald-300 hover:text-emerald-600"
            >
              {lang === "zh" ? "图片成品库" : "Image Gallery"}
            </Link>
            <Link
              href="/gallery/video"
              className="rounded-full border border-blue-500 bg-blue-50 px-3 py-1.5 text-sm text-blue-600"
            >
              {lang === "zh" ? "视频成品库" : "Video Gallery"}
            </Link>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {lang === "zh" ? "加载中..." : "Loading..."}
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            <div className="mb-3 text-4xl">🎬</div>
            <div>{lang === "zh" ? "暂无已完成视频" : "No completed videos yet"}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {jobs.map((job) => {
              const coverUrl = toImageUrl(job.first_frame_url);
              const title = job.notes?.trim() || (lang === "zh" ? "未命名" : "Untitled");

              return (
                <div
                  key={job.id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
                  <div className="relative aspect-[9/16] w-full overflow-hidden bg-black/30">
                    {coverUrl ? (
                      <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl text-gray-300">🎬</div>
                    )}
                  </div>
                  <div className="flex-1 px-2 py-2">
                    <p className="truncate text-xs font-medium text-gray-800">{title}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{formatDate(job.created_at)}</p>
                  </div>
                  <div className="flex gap-1.5 px-2 pb-2">
                    <button
                      type="button"
                      onClick={() => setPreviewJob(job)}
                      className="flex-1 rounded-lg bg-gray-100 py-1.5 text-[11px] text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      {lang === "zh" ? "预览" : "Preview"}
                    </button>
                    <Link
                      href={`/workflows/video?job_id=${job.id}`}
                      className="flex-1 rounded-lg bg-blue-600/80 py-1.5 text-center text-[11px] text-white transition-colors hover:bg-blue-600"
                    >
                      {lang === "zh" ? "编辑" : "Edit"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {previewJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewJob(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-sm overflow-hidden rounded-2xl bg-black"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewJob(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/80"
            >
              ✕
            </button>
            <video
              src={getPreviewVideoUrl(previewJob)}
              poster={toImageUrl(previewJob.first_frame_url) || undefined}
              controls
              autoPlay
              className="h-auto w-full"
              style={{ maxHeight: "85vh" }}
            />
            <div className="p-3">
              <p className="text-sm font-medium text-white">
                {previewJob.notes ?? (lang === "zh" ? "未命名" : "Untitled")}
              </p>
              <p className="text-xs text-white/50">{formatDate(previewJob.created_at)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

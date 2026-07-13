"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import PageHeader from "@/components/common/PageHeader";
import { apiDelete } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

interface VideoJob {
  id: string;
  session_id?: number;
  status: string;
  current_step: number;
  first_frame_url?: string;
  first_frame_status: string;
  video_language: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<string, { zh: string; en: string; color: string }> = {
  draft: { zh: "草稿", en: "Draft", color: "bg-gray-100 text-gray-600" },
  step1_done: { zh: "首帧已选", en: "Frame Set", color: "bg-blue-50 text-blue-600" },
  step2_done: { zh: "草稿已选", en: "Draft Set", color: "bg-blue-50 text-blue-600" },
  step3_done: { zh: "动作已提炼", en: "Motion Set", color: "bg-indigo-50 text-indigo-600" },
  step4_done: { zh: "动效已配", en: "Motion FX", color: "bg-purple-50 text-purple-600" },
  step5_done: { zh: "终稿已选", en: "Final Set", color: "bg-green-50 text-green-600" },
  post_processing: { zh: "后处理中", en: "Processing", color: "bg-yellow-50 text-yellow-700" },
  completed: { zh: "已完成", en: "Completed", color: "bg-green-100 text-green-700" },
  archived: { zh: "已归档", en: "Archived", color: "bg-gray-200 text-gray-500" },
};

export default function VideosPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"draft" | "completed">("draft");

  useEffect(() => {
    const token = localStorage.getItem("token") ?? "";
    if (!token) {
      router.push("/login");
      return;
    }

    fetch(`${API_BASE}/api/video/jobs/list?page=1&page_size=30`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((res) => {
        if (res?.code === 0) {
          const data = res.data;
          const items: VideoJob[] = Array.isArray(data) ? data : (data?.items ?? []);
          const filtered =
            activeTab === "completed"
              ? items.filter((job) => job.status === "completed")
              : items.filter((job) => job.status !== "completed");
          setJobs(filtered);
          setTotal(filtered.length);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [API_BASE, router, activeTab]);

  const handleDelete = async (jobId: string) => {
    await apiDelete(`/api/video/jobs/${jobId}`);
    setJobs((prev) => prev.filter((item) => item.id !== jobId));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  const statusMeta = (status: string) =>
    STATUS_LABEL[status] ?? { zh: status, en: status, color: "bg-gray-100 text-gray-500" };

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader
        title={t("视频工作台")}
        description={`${total} ${t("条视频任务")}`}
        action={
          <div className="flex items-center gap-2">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setActiveTab("draft")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "draft"
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {lang === "zh" ? "草稿" : "Draft"}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("completed")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "completed"
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {lang === "zh" ? "已完成" : "Completed"}
              </button>
            </div>
            <button
              onClick={() => router.push("/workflows/video")}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              {lang === "zh" ? "新建视频" : "New Video"}
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-gray-400">{t("加载中...")}</div>
      ) : jobs.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <div className="mb-3 text-4xl">🎬</div>
          <div>{t("还没有视频任务")}</div>
          <button
            onClick={() => router.push("/workflows/video")}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            {t("新建视频")}
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {jobs.map((job) => {
            const meta = statusMeta(job.status);
            return (
              <div
                key={job.id}
                onClick={() => router.push(`/workflows/video?job_id=${job.id}`)}
                className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-blue-200 hover:shadow-sm"
              >
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {job.first_frame_url ? (
                    <img
                      src={
                        job.first_frame_url.startsWith("http")
                          ? job.first_frame_url
                          : `${API_BASE}${job.first_frame_url}`
                      }
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl text-gray-300">🎬</div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {job.notes && <div className="mb-1 truncate text-sm font-medium text-gray-800">{job.notes}</div>}
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                      {lang === "zh" ? meta.zh : meta.en}
                    </span>
                    <span className="text-xs text-gray-400">
                      {t("步骤")} {job.current_step} / 7
                    </span>
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    ID: {job.id.slice(0, 8)}… · {job.video_language}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  <div className="text-xs text-gray-400">{new Date(job.updated_at).toLocaleDateString()}</div>
                  <button
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (
                        confirm(`确定要归档「${job.notes || "未命名"}」吗？归档后可在已归档列表找回。`)
                      ) {
                        await handleDelete(job.id);
                      }
                    }}
                    className="flex-shrink-0 px-2 text-xs text-gray-300 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

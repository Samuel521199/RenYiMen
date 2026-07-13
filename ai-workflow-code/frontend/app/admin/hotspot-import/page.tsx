"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

interface NewsTask {
  id: number;
  task_id: string;
  title: string;
  publish_time: string | null;
  topic_type: string;
  event_summary: string | null;
  risk_level: string;
  allow_game_integration: boolean;
  risk_tags: string[];
  source_name: string | null;
  import_status: string;
  process_status: string;
  image_status: string;
  imported_at: string;
}

interface ImportResult {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  total: number;
  tasks: NewsTask[];
  skipped: { task_id: string; reason: string }[];
  errors: { error_type: string; message: string; task_id?: string }[];
}

const RISK_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  LOW: "bg-green-100 text-green-700",
};

const PROCESS_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  SELECTED: "已选取",
  ARCHIVED: "已归档",
};

const PROCESS_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  SELECTED: "bg-blue-100 text-blue-600",
  ARCHIVED: "bg-green-100 text-green-700",
};

export default function HotspotImportPage() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<NewsTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTopic, setFilterTopic] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTasks = (status?: string, topic?: string) => {
    setLoadingTasks(true);
    let url = "/api/hotspot/tasks?limit=100";
    if (status) url += `&status=${status}`;
    if (topic) url += `&topic_type=${topic}`;
    apiGet(url)
      .then((res: any) => {
        if (res?.data) setTasks(res.data);
      })
      .finally(() => setLoadingTasks(false));
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      setError(t("请上传 .json 格式文件"));
      return;
    }

    setUploading(true);
    setError("");
    setImportResult(null);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
      const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/api/hotspot/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (data?.data) {
        setImportResult(data.data);
        loadTasks(filterStatus, filterTopic);
      } else {
        setError(t("导入失败：") + (data?.msg || t("未知错误")));
      }
    } catch (err: any) {
      setError(t("上传失败：") + (err?.message || t("网络错误")));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filterStatus && t.process_status !== filterStatus) return false;
    if (filterTopic && t.topic_type !== filterTopic) return false;
    return true;
  });

  const topicTypes = Array.from(new Set(tasks.map((t) => t.topic_type)));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("热点新闻导入")}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("上传新闻工作台导出的 JSON 文件，导入后可在「热点借势·新闻推送」工作流中使用")}
          </p>
        </div>
        <a
          href="/workflows/trending-news"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("前往生产工作流 →")}
        </a>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-700">{t("上传 JSON 文件")}</h2>

        <div
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-8 text-center transition-all hover:border-blue-400 hover:bg-blue-50"
        >
          <div className="mb-3 text-4xl">📂</div>
          <div className="text-sm font-medium text-gray-600">
            {uploading ? t("导入中，请稍候…") : t("点击选择 JSON 文件")}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {t("支持新闻热点工作台标准导出格式（schema_version: 1.0）")}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
            <button onClick={() => setError("")} className="ml-2 text-red-400">
              ✕
            </button>
          </div>
        )}

        {importResult && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: t("总计"), value: importResult.total, color: "bg-gray-50 text-gray-700" },
                { label: t("成功导入"), value: importResult.imported_count, color: "bg-green-50 text-green-700" },
                { label: t("跳过"), value: importResult.skipped_count, color: "bg-yellow-50 text-yellow-700" },
                { label: t("错误"), value: importResult.error_count, color: "bg-red-50 text-red-700" },
              ].map((item) => (
                <div key={item.label} className={`rounded-lg p-3 text-center ${item.color}`}>
                  <div className="text-2xl font-bold">{item.value}</div>
                  <div className="mt-0.5 text-xs">{item.label}</div>
                </div>
              ))}
            </div>

            {importResult.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="mb-2 text-sm font-medium text-red-700">{t("错误详情")}</div>
                {importResult.errors.map((err, i) => (
                  <div key={i} className="mb-1 text-xs text-red-600">
                    [{err.error_type}] {err.task_id && `(${err.task_id}) `}
                    {err.message}
                  </div>
                ))}
              </div>
            )}

            {importResult.skipped.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <div className="mb-2 text-sm font-medium text-yellow-700">{t("跳过详情（重复数据）")}</div>
                {importResult.skipped.map((s, i) => (
                  <div key={i} className="mb-1 text-xs text-yellow-600">
                    {s.task_id} — {s.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">
            {t("已导入热点")}
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({filteredTasks.length} {t("条")})
            </span>
          </h2>
          <button
            onClick={() => loadTasks(filterStatus, filterTopic)}
            disabled={loadingTasks}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            {loadingTasks ? t("加载中…") : t("刷新")}
          </button>
        </div>

        <div className="mb-4 flex gap-3">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">{t("全部状态")}</option>
            <option value="PENDING">{t("待处理")}</option>
            <option value="SELECTED">{t("已选取")}</option>
            <option value="ARCHIVED">{t("已归档")}</option>
          </select>
          <select
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">{t("全部分类")}</option>
            {topicTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {loadingTasks ? (
          <div className="py-8 text-center text-gray-400">{t("加载中…")}</div>
        ) : filteredTasks.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <div className="mb-3 text-3xl">📭</div>
            <div className="text-sm">{t("暂无热点数据，请先上传 JSON 文件")}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-xl border border-gray-200 p-4 transition-all hover:border-gray-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800">{task.title}</div>
                    {task.event_summary && (
                      <div className="mt-1 line-clamp-2 text-xs text-gray-500">{task.event_summary}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {task.topic_type}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${RISK_COLORS[task.risk_level] || "bg-gray-100 text-gray-500"}`}
                      >
                        {task.risk_level}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${PROCESS_STATUS_COLORS[task.process_status] || "bg-gray-100 text-gray-500"}`}
                      >
                        {t(PROCESS_STATUS_LABELS[task.process_status] || task.process_status)}
                      </span>
                      {task.source_name && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                          {task.source_name}
                        </span>
                      )}
                      {task.allow_game_integration && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600">
                          {t("允许游戏")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-xs text-gray-400">
                    <div>{task.task_id}</div>
                    {task.publish_time && (
                      <div className="mt-0.5">{new Date(task.publish_time).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <h2 className="mb-3 text-base font-semibold text-gray-700">{t("JSON 格式说明")}</h2>
        <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-600">{`{
  "schema_version": "1.0",
  "export_time": "2026-05-04 18:30:00",
  "source_system": "news_hotspot_workbench",
  "items": [
    {
      "task_id": "news_20260504_001",
      "title": "热点标题",
      "publish_time": "2026-05-04 10:30:00",
      "topic_type": "SPORTS_EVENT",
      "event_summary": "一句话摘要",
      "main_entities": ["实体1", "实体2"],
      "event_action": "发生了什么",
      "event_result": "结果如何",
      "emotion_direction": "HYPE",
      "risk_tags": ["NONE"],
      "local_relevance": "本地相关性",
      "source_name": "媒体名称",
      "source_url": "https://example.com"
    }
  ]
}`}</pre>
        <div className="mt-3 space-y-1 text-xs text-gray-500">
          <div>
            <span className="font-medium">{t("topic_type 枚举：")}</span>
            BREAKING_NEWS / SPORTS_EVENT / ENTERTAINMENT / SOCIAL_TOPIC / HOLIDAY_EVENT /
            POLITICS_GOVERNMENT / CRIME_ACCIDENT / DISASTER_EMERGENCY / ECONOMY_BUSINESS /
            TECH_GAMING / PUBLIC_FIGURE / VIRAL_TREND
          </div>
          <div>
            <span className="font-medium">{t("risk_tags 枚举：")}</span>
            NONE / DEATH / INJURY / DISASTER / CRIME / POLITICS / RELIGION / LEGAL / MINOR /
            SEXUAL / HATE / PUBLIC_FIGURE / FINANCIAL_RISK / MEDICAL / MISINFORMATION_RISK
          </div>
        </div>
      </div>
    </div>
  );
}

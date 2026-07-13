"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useLanguage } from "@/lib/LanguageContext";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { getTagLabel } from "@/lib/tag-display";

interface NewsTask {
  id: number;
  task_id: string;
  title: string;
  publish_time: string | null;
  topic_type: string;
  event_summary: string | null;
  main_entities: string[];
  event_action: string | null;
  event_result: string | null;
  emotion_direction: string | null;
  risk_tags: string[];
  local_relevance: string | null;
  source_name: string | null;
  source_url: string | null;
  risk_level: string;
  allow_game_integration: boolean;
  process_status: string;
  image_status: string;
}

interface TopicTypeConfig {
  id: number;
  topic_type: string;
  name_zh: string;
  risk_level: string;
  allow_game_integration: boolean;
  allowed_angles: string[];
  allowed_image_types: string[];
  allowed_actions: string[];
  copy_style: string;
  notes: string | null;
}

interface ReviewImage {
  id: string;
  url: string;
  reviewStatus: "pending" | "archived" | "refine" | "deleted" | "done";
}

interface WorkflowState {
  sessionId: number | null;
  selectedNewsTaskId: number | null;
  selectedNewsTask: NewsTask | null;
  riskLevel: string;
  allowGameIntegration: boolean;
  allowedAngles: string[];
  allowedImageTypes: string[];
  allowedActions: string[];
  copyStyle: string;
  configNotes: string;
  selectedAngle: string;
  selectedImageType: string;
  selectedAction: string;
  copyText: string;
  referenceAssetIds: number[];
  adSize: string;
  imageLanguage: string;
  jobId: number | null;
  finalImages: ReviewImage[];
  archivedImageCount: number;
}

const ANGLE_LABELS: Record<string, string> = {
  REACTION: "吃瓜反应",
  REACTION_ONLY: "吃瓜反应",
  STANCE: "站队对抗",
  RESULT: "结果情绪",
  DISCUSSION: "评论引导",
  LIGHT_GAME: "轻游戏带入",
};

const IMAGE_TYPE_LABELS: Record<string, string> = {
  REACTION: "单牛情绪图",
  VS: "左右对抗图",
  SCENE: "场景嵌入图",
};

const RISK_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700 border-red-300",
  MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-300",
  LOW: "bg-green-100 text-green-700 border-green-300",
};

const AD_SIZES = [
  { value: "1080x1080", label: "FB 方图 (1080×1080)" },
  { value: "1080x1920", label: "TikTok 竖版 (1080×1920)" },
  { value: "1080x566", label: "FB 横版 (1080×566)" },
];

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "taglish", label: "Taglish" },
  { value: "chinese", label: "中文" },
];

const ACTION_TAG_HINTS: Record<string, string[]> = {
  吃瓜: ["看新闻吃瓜"],
  震惊: ["看新闻吃瓜", "看比赛"],
  无语: ["堵车烦躁"],
  欢呼: ["赢牌欢呼", "看比赛"],
  崩溃: ["输牌倒地", "堵车烦躁"],
  紧张: ["看牌紧张", "看比赛"],
  偷笑: ["唱歌", "跳舞"],
  思考: ["堵车烦躁"],
  困惑: ["堵车烦躁"],
  开心: ["发薪日", "唱歌"],
  庆祝: ["发薪日", "跳舞"],
  邀请: ["唱歌", "跳舞"],
};

const initialState: WorkflowState = {
  sessionId: null,
  selectedNewsTaskId: null,
  selectedNewsTask: null,
  riskLevel: "",
  allowGameIntegration: false,
  allowedAngles: [],
  allowedImageTypes: [],
  allowedActions: [],
  copyStyle: "",
  configNotes: "",
  selectedAngle: "",
  selectedImageType: "",
  selectedAction: "",
  copyText: "",
  referenceAssetIds: [],
  adSize: "1080x1080",
  imageLanguage: "english",
  jobId: null,
  finalImages: [],
  archivedImageCount: 0,
};

function TrendingNewsWorkflowContent() {
  const { t, lang } = useLanguage();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [ws, setWs] = useState<WorkflowState>(initialState);
  const [configs, setConfigs] = useState<TopicTypeConfig[]>([]);
  const [newsTasks, setNewsTasks] = useState<NewsTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [generateCount, setGenerateCount] = useState(2);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [refinePrompts, setRefinePrompts] = useState<Record<string, string>>({});
  const [refining, setRefining] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [refAssets, setRefAssets] = useState<any[]>([]);
  const [refTags, setRefTags] = useState<string[]>([]);
  const [refTagFilter, setRefTagFilter] = useState("");
  const [refLoading, setRefLoading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const fullUrl = (url: string) => (url.startsWith("http") ? url : `${API_BASE}${url}`);

  useEffect(() => {
    apiGet("/api/trending/topic-configs").then((res: any) => {
      if (res?.data) setConfigs(res.data);
    });
    apiGet("/api/model-configs/available?purpose=image").then((res: any) => {
      if (res?.data) {
        setModels(res.data);
        if (res.data.length > 0) setSelectedModelId(res.data[0].id);
      }
    });
  }, []);

  const loadNewsTasks = () => {
    setLoadingTasks(true);
    apiGet("/api/hotspot/tasks?status=PENDING&limit=50")
      .then((res: any) => {
        if (res?.data) setNewsTasks(res.data);
      })
      .finally(() => setLoadingTasks(false));
  };

  useEffect(() => {
    if (step === 1) loadNewsTasks();
  }, [step]);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return;
    setRestoring(true);
    apiGet(`/api/workflow-sessions/${sessionId}`)
      .then((res: any) => {
        if (res?.data?.state_json) {
          const saved = JSON.parse(res.data.state_json);
          setWs((prev) => ({ ...prev, ...saved, sessionId: Number(sessionId) }));
          if (res.data.current_step) setStep(res.data.current_step);
        }
      })
      .catch(() => setError(t("草稿恢复失败")))
      .finally(() => setRestoring(false));
  }, [searchParams]);

  const autoSave = (
    stateOverride?: Partial<WorkflowState>,
    status = "draft",
    currentStep = step,
  ) => {
    const state = stateOverride ? { ...ws, ...stateOverride } : ws;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        const res: any = await apiPost("/api/workflow-sessions/save", {
          session_id: state.sessionId,
          workflow_type: "trending_news",
          mode: "full",
          current_step: currentStep,
          status,
          state_json: JSON.stringify(state),
        });
        if (res?.data?.id) setWs((prev) => ({ ...prev, sessionId: res.data.id }));
      } catch {}
    });
  };

  const goToStep = (n: number) => {
    autoSave(undefined, "draft", n);
    setStep(n);
  };

  const fuzzyMatchTags = (tags: string[], action: string): string[] => {
    if (!action) return [];
    const exact = tags.filter((t) => t.includes(action));
    if (exact.length > 0) return exact;
    const hints = ACTION_TAG_HINTS[action] || [];
    const hinted = hints.filter((h) => tags.includes(h));
    if (hinted.length > 0) return hinted;
    return tags.filter((t) => action.split("").some((kw) => t.includes(kw)));
  };

  const loadRefAssets = (tag?: string) => {
    setRefLoading(true);
    setRefAssets([]);
    const base = `/api/assets?exclude_category=background&limit=40`;
    const params = tag ? `${base}&tag=${encodeURIComponent(tag)}` : base;
    apiGet(params)
      .then((res: any) => {
        if (Array.isArray(res?.data)) setRefAssets(res.data);
      })
      .finally(() => setRefLoading(false));
  };

  useEffect(() => {
    if (step !== 4) return;
    apiGet("/api/assets/tags").then((res: any) => {
      const tags = Array.from(new Set((res?.data?.map((t: any) => t.name) || []) as string[]));
      setRefTags(tags);
      const matched = fuzzyMatchTags(tags, ws.selectedAction);
      if (matched.length > 0) {
        setRefTagFilter(matched[0]);
      } else {
        setRefTagFilter("");
      }
    });
  }, [step]);

  // 标签切换时重新加载素材
  useEffect(() => {
    if (step !== 4) return;
    setRefAssets([]);
    setRefLoading(true);
    const params = refTagFilter
      ? `/api/assets?exclude_category=background&tags=${encodeURIComponent(refTagFilter)}&limit=40`
      : `/api/assets?exclude_category=background&limit=40`;
    apiGet(params)
      .then((res: any) => {
        if (Array.isArray(res?.data)) setRefAssets(res.data);
      })
      .finally(() => setRefLoading(false));
  }, [refTagFilter, step]);

  const handleSelectTask = (task: NewsTask) => {
    const cfg = configs.find((c) => c.topic_type === task.topic_type);
    setWs((p) => ({
      ...p,
      selectedNewsTaskId: task.id,
      selectedNewsTask: task,
      riskLevel: task.risk_level || cfg?.risk_level || "",
      allowGameIntegration: task.allow_game_integration,
      allowedAngles: cfg?.allowed_angles || [],
      allowedImageTypes: cfg?.allowed_image_types || [],
      allowedActions: cfg?.allowed_actions || [],
      copyStyle: cfg?.copy_style || "",
      configNotes: cfg?.notes || "",
    }));
  };

  const createJob = async (): Promise<number | null> => {
    if (!ws.selectedNewsTask) return null;
    try {
      const res: any = await apiPost("/api/trending/jobs/create", {
        news_title: ws.selectedNewsTask.title,
        publish_time: ws.selectedNewsTask.publish_time,
        topic_type: ws.selectedNewsTask.topic_type,
        ad_size: ws.adSize,
        image_language: ws.imageLanguage,
        session_id: ws.sessionId,
      });
      if (res?.data?.id) {
        const jobId = res.data.id;
        if (ws.selectedAngle || ws.selectedAction) {
          await apiPatch(`/api/trending/jobs/${jobId}`, {
            selected_angle: ws.selectedAngle,
            selected_image_type: ws.selectedImageType,
            selected_action: ws.selectedAction,
            copy_text: ws.copyText,
          });
        }
        setWs((p) => ({ ...p, jobId }));
        autoSave({ jobId });
        await apiPatch(`/api/hotspot/tasks/${ws.selectedNewsTaskId}/status?process_status=SELECTED`, {}).catch(
          () => {},
        );
        return jobId;
      }
    } catch (e: any) {
      setError(t("创建任务失败：") + (e?.message || t("未知错误")));
    }
    return null;
  };

  const handleGenerate = async () => {
    if (!ws.jobId || !selectedModelId) return;
    setGenerating(true);
    setGenerateProgress(0);
    setError("");
    for (let i = 0; i < generateCount; i++) {
      try {
        const res: any = await apiPost(
          `/api/trending/jobs/${ws.jobId}/generate-final`,
          {
            model_config_id: selectedModelId,
            count: 1,
            extra_prompt: extraPrompt || null,
            reference_asset_ids: ws.referenceAssetIds,
          },
          120000,
        );
        const urls: string[] = res?.data?.image_urls || [];
        const newImgs: ReviewImage[] = urls.map((url) => ({
          id: `${Date.now()}-${Math.random()}`,
          url,
          reviewStatus: "pending",
        }));
        setWs((p) => {
          const updated = { ...p, finalImages: [...p.finalImages, ...newImgs] };
          autoSave(updated);
          return updated;
        });
      } catch (e: any) {
        setError(`${t("第")} ${i + 1} ${t("张生成失败：")}${e?.message || t("未知错误")}`);
      }
      setGenerateProgress(i + 1);
    }
    setGenerating(false);
  };

  const handleRefine = async (imgId: string) => {
    if (!ws.jobId || !selectedModelId) return;
    const prompt = refinePrompts[imgId];
    if (!prompt?.trim()) return;
    setRefining(imgId);
    try {
      const res: any = await apiPost(
        `/api/trending/jobs/${ws.jobId}/refine`,
        {
          model_config_id: selectedModelId,
          refine_prompt: prompt,
          reference_asset_ids: ws.referenceAssetIds,
        },
        120000,
      );
      const urls: string[] = res?.data?.image_urls || [];
      if (urls[0]) {
        setWs((p) => {
          const updated = {
            ...p,
            finalImages: p.finalImages.map((i) =>
              i.id === imgId ? { ...i, url: urls[0], reviewStatus: "pending" as const } : i,
            ),
          };
          autoSave(updated);
          return updated;
        });
        setRefinePrompts((p) => ({ ...p, [imgId]: "" }));
      }
    } catch (e: any) {
      setError(t("精修失败：") + (e?.message || t("未知错误")));
    }
    setRefining(null);
  };

  const handleArchive = async (imgId: string) => {
    if (!ws.jobId) return;
    const img = ws.finalImages.find((i) => i.id === imgId);
    if (!img) return;
    setArchiving(imgId);
    try {
      await apiPost(`/api/trending/jobs/${ws.jobId}/archive`, { image_url: img.url });
      const newCount = ws.archivedImageCount + 1;
      setWs((p) => {
        const updated = {
          ...p,
          archivedImageCount: newCount,
          finalImages: p.finalImages.map((i) =>
            i.id === imgId ? { ...i, reviewStatus: "done" as const } : i,
          ),
        };
        const allDone = updated.finalImages.every(
          (i) => i.reviewStatus !== "pending" && i.reviewStatus !== "archived" && i.reviewStatus !== "refine",
        );
        autoSave(updated, allDone && newCount > 0 ? "completed" : "draft");
        return updated;
      });
      if (ws.selectedNewsTaskId) {
        await apiPatch(
          `/api/hotspot/tasks/${ws.selectedNewsTaskId}/status?process_status=ARCHIVED&image_status=FINAL_GENERATED`,
          {},
        ).catch(() => {});
      }
    } catch (e: any) {
      setError(t("归档失败：") + (e?.message || t("未知错误")));
    }
    setArchiving(null);
  };

  const steps = ["选热点", "约束预览", "借势参数", "规格设置", "生成图片", "审核归档"];

  if (restoring) {
    return <div className="flex h-64 items-center justify-center text-gray-500">{t("恢复草稿中…")}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center gap-0">
        {steps.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={n} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-all ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : done
                        ? "border-green-500 bg-green-500 text-white"
                        : "border-gray-300 bg-white text-gray-400"
                  }`}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  className={`mt-1 whitespace-nowrap text-xs ${
                    active ? "font-medium text-blue-600" : "text-gray-400"
                  }`}
                >
                  {t(label)}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`mx-1 mb-4 h-0.5 flex-1 ${done ? "bg-green-400" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{t("热点借势图 · 新闻推送")}</h1>
          <p className="mt-0.5 text-xs text-gray-400">{t("从新闻推送列表选择热点，自动填入配置")}</p>
        </div>
        <button
          onClick={() => autoSave()}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
        >
          {t("保存草稿")}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button onClick={() => setError("")} className="ml-2 text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-700">{t("Step 1 · 选择热点")}</h2>
            <button
              onClick={loadNewsTasks}
              disabled={loadingTasks}
              className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              {loadingTasks ? t("加载中…") : t("刷新")}
            </button>
          </div>

          {loadingTasks ? (
            <div className="py-8 text-center text-gray-400">{t("加载新闻热点中…")}</div>
          ) : newsTasks.length === 0 ? (
            <div className="space-y-3 py-12 text-center">
              <div className="text-sm text-gray-400">{t("暂无待处理的新闻热点")}</div>
              <div className="text-xs text-gray-300">{t("请先在「导入热点」页面上传新闻 JSON 文件")}</div>
              <a href="/admin/hotspot-import" className="inline-block text-xs text-blue-500 hover:underline">
                {t("前往导入页面 →")}
              </a>
            </div>
          ) : (
            <div className="max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {newsTasks.map((task) => {
                const selected = ws.selectedNewsTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all ${
                      selected
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                        : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug text-gray-800">{task.title}</div>
                        {task.event_summary && (
                          <div className="mt-1 line-clamp-2 text-xs text-gray-500">{task.event_summary}</div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {task.topic_type}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${RISK_COLORS[task.risk_level] || "bg-gray-100 text-gray-600"}`}
                          >
                            {task.risk_level}
                          </span>
                          {task.source_name && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                              {task.source_name}
                            </span>
                          )}
                          {task.main_entities?.slice(0, 2).map((e) => (
                            <span key={e} className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600">
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                      {selected && (
                        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                          ✓
                        </div>
                      )}
                    </div>
                    {task.publish_time && (
                      <div className="mt-2 text-xs text-gray-400">
                        {new Date(task.publish_time).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                if (!ws.selectedNewsTaskId) {
                  setError(t("请先选择一条热点"));
                  return;
                }
                setError("");
                goToStep(2);
              }}
              disabled={!ws.selectedNewsTaskId}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {t("下一步")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 2 · 约束预览")}</h2>
          <p className="text-xs text-gray-400">{t("配置由系统根据热点分类自动生成，不可修改。")}</p>

          {ws.selectedNewsTask && (
            <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="font-medium text-gray-700">{ws.selectedNewsTask.title}</div>
              {ws.selectedNewsTask.event_summary && (
                <div className="text-xs text-gray-500">{ws.selectedNewsTask.event_summary}</div>
              )}
              {ws.selectedNewsTask.source_name && (
                <div className="text-xs text-blue-500">{t("来源：")}{ws.selectedNewsTask.source_name}</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className={`rounded-lg border p-3 text-center ${RISK_COLORS[ws.riskLevel] || "bg-gray-50 text-gray-600"}`}>
              <div className="mb-1 text-xs font-medium">{t("风险等级")}</div>
              <div className="text-lg font-bold">{ws.riskLevel}</div>
            </div>
            <div
              className={`rounded-lg border p-3 text-center ${
                ws.allowGameIntegration
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-orange-300 bg-orange-50 text-orange-700"
              }`}
            >
              <div className="mb-1 text-xs font-medium">{t("游戏元素")}</div>
              <div className="text-lg font-bold">{ws.allowGameIntegration ? t("允许 ✅") : t("禁止 🚫")}</div>
            </div>
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-center text-blue-700">
              <div className="mb-1 text-xs font-medium">{t("文案风格")}</div>
              <div className="text-lg font-bold">{ws.copyStyle}</div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium text-gray-600">{t("可用借势角度：")}</span>
              <span className="text-gray-700">{ws.allowedAngles.map((a) => t(ANGLE_LABELS[a] || a)).join(" / ")}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">{t("可用图片类型：")}</span>
              <span className="text-gray-700">
                {ws.allowedImageTypes.map((item) => t(IMAGE_TYPE_LABELS[item] || item)).join(" / ")}
              </span>
            </div>
            <div>
              <span className="font-medium text-gray-600">{t("可用牛动作：")}</span>
              <span className="text-gray-700">{ws.allowedActions.join(" / ")}</span>
            </div>
            {ws.configNotes && (
              <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700">
                ⚠️ {ws.configNotes}
              </div>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(1)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("上一步")}
            </button>
            <button
              onClick={() => goToStep(3)}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("确认，下一步")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 3 · 借势参数设置")}</h2>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("借势角度 *")}</label>
            <div className="flex flex-wrap gap-2">
              {ws.allowedAngles.map((angle) => (
                <button
                  key={angle}
                  onClick={() => setWs((prev) => ({ ...prev, selectedAngle: angle }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                    ws.selectedAngle === angle
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(ANGLE_LABELS[angle] || angle)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("图片类型 *")}</label>
            <div className="flex flex-wrap gap-2">
              {ws.allowedImageTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setWs((prev) => ({ ...prev, selectedImageType: type }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                    ws.selectedImageType === type
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(IMAGE_TYPE_LABELS[type] || type)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("牛动作 *")}</label>
            <div className="flex flex-wrap gap-2">
              {ws.allowedActions.map((action) => (
                <button
                  key={action}
                  onClick={() => setWs((prev) => ({ ...prev, selectedAction: action }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                    ws.selectedAction === action
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">{t("配套文案（选填）")}</label>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={t("留空则由 AI 自动生成")}
              value={ws.copyText}
              onChange={(e) => setWs((prev) => ({ ...prev, copyText: e.target.value }))}
            />
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(2)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("上一步")}
            </button>
            <button
              onClick={() => {
                if (!ws.selectedAngle || !ws.selectedImageType || !ws.selectedAction) {
                  setError(t("请选择角度、类型和动作"));
                  return;
                }
                setError("");
                goToStep(4);
              }}
              disabled={!ws.selectedAngle || !ws.selectedImageType || !ws.selectedAction}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {t("下一步")}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 4 · 规格设置")}</h2>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("图片尺寸")}</label>
            <div className="flex flex-col gap-2">
              {AD_SIZES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setWs((prev) => ({ ...prev, adSize: s.value }))}
                  className={`rounded-lg border px-4 py-2 text-left text-sm transition-all ${
                    ws.adSize === s.value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("图片文字语言")}</label>
            <div className="flex gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  onClick={() => setWs((prev) => ({ ...prev, imageLanguage: l.value }))}
                  className={`rounded-lg border px-4 py-2 text-sm transition-all ${
                    ws.imageLanguage === l.value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(l.label)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              {t("参考图（选填）")}
              {ws.referenceAssetIds.length > 0 && (
                <span className="ml-2 font-normal text-blue-600">{t("已选")} {ws.referenceAssetIds.length} {t("张")}</span>
              )}
            </label>
            {ws.selectedAction && refTagFilter && (
              <div className="mb-2 rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-600">
                {t("🎯 已根据动作")}「{ws.selectedAction}」{t("自动匹配标签")}「{refTagFilter}」
              </div>
            )}
            {refTags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setRefTagFilter("")}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-all ${
                    refTagFilter === ""
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-500 hover:border-blue-400"
                  }`}
                >
                  {t("全部")}
                </button>
                {refTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setRefTagFilter(tag)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-all ${
                      refTagFilter === tag
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-500 hover:border-blue-400"
                    }`}
                  >
                    {getTagLabel(tag, lang)}
                  </button>
                ))}
              </div>
            )}
            <div>
              {refLoading ? (
                <div className="py-4 text-center text-sm text-gray-400">{t("加载中…")}</div>
              ) : refAssets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-sm text-gray-400">
                  {t("暂无素材")}
                </div>
              ) : (
                <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto pr-1">
                  {refAssets.map((asset) => {
                    const selected = ws.referenceAssetIds.includes(asset.id);
                    return (
                      <div
                        key={asset.id}
                        onClick={() =>
                          setWs((prev) => ({
                            ...prev,
                            referenceAssetIds: selected
                              ? prev.referenceAssetIds.filter((id) => id !== asset.id)
                              : prev.referenceAssetIds.length < 4
                                ? [...prev.referenceAssetIds, asset.id]
                                : prev.referenceAssetIds,
                          }))
                        }
                        className={`relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                          selected ? "border-blue-500 ring-2 ring-blue-300" : "border-transparent hover:border-gray-300"
                        }`}
                      >
                        <img src={`${API_BASE}${asset.url}`} alt="" className="aspect-square w-full object-cover" />
                        {selected && (
                          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                              {ws.referenceAssetIds.indexOf(asset.id) + 1}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 已选预览 */}
            <div
              className={`mt-3 rounded-lg border p-3 transition-all ${ws.referenceAssetIds.length > 0 ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">{t("已选参考图")} ({ws.referenceAssetIds.length}/4)</span>
                {ws.referenceAssetIds.length > 0 && (
                  <button
                    onClick={() => setWs((p) => ({ ...p, referenceAssetIds: [] }))}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    {t("清空全部")}
                  </button>
                )}
              </div>
              {ws.referenceAssetIds.length === 0 ? (
                <div className="py-2 text-center text-xs text-gray-400">{t("未选择参考图，点击上方图片选择")}</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ws.referenceAssetIds.map((id, idx) => {
                    const asset = refAssets.find((a) => a.id === id);
                    return (
                      <div key={id} className="relative h-14 w-14 flex-shrink-0">
                        {asset ? (
                          <img
                            src={`${API_BASE}${asset.url}`}
                            alt=""
                            className="h-full w-full rounded-lg border-2 border-blue-400 object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center rounded-lg border-2 border-blue-200 bg-blue-100 text-xs text-blue-400">
                            {idx + 1}
                          </div>
                        )}
                        <div className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                          {idx + 1}
                        </div>
                        <button
                          onClick={() =>
                            setWs((p) => ({
                              ...p,
                              referenceAssetIds: p.referenceAssetIds.filter((i) => i !== id),
                            }))
                          }
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(3)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("上一步")}
            </button>
            <button
              onClick={async () => {
                setLoading(true);
                setError("");
                const jobId = ws.jobId || (await createJob());
                setLoading(false);
                if (jobId) goToStep(5);
              }}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {loading ? t("创建中…") : t("下一步，开始生成")}
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 5 · 生成图片")}</h2>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("选择模型")}</label>
            <select
              value={selectedModelId ?? ""}
              onChange={(e) => setSelectedModelId(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">{t("-- 选择模型 --")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("出图数量")}</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setGenerateCount(n)}
                  className={`h-10 w-10 rounded-lg border text-sm font-medium transition-all ${
                    generateCount === n
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">{t("额外描述（选填）")}</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={t("补充说明")}
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || !selectedModelId || !ws.jobId}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-40"
          >
            {generating ? `${t("生成中")} ${generateProgress}/${generateCount}…` : t("生成图片")}
          </button>

          {ws.finalImages.length > 0 && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-gray-600">{t("生成结果")}</div>
              {ws.finalImages
                .filter((img) => img.reviewStatus !== "deleted")
                .map((img) => {
                  const url = fullUrl(img.url);
                  return (
                    <div
                      key={img.id}
                      className={`overflow-hidden rounded-xl border ${
                        img.reviewStatus === "refine" ? "border-yellow-400 ring-2 ring-yellow-200" : "border-gray-200"
                      }`}
                    >
                      <img
                        src={url}
                        alt={t("生成图")}
                        className="w-full cursor-pointer hover:opacity-95"
                        onClick={() => setPreviewUrl(url)}
                      />
                      <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-3">
                        {img.reviewStatus !== "archived" && img.reviewStatus !== "done" && (
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "archived" as const } : i,
                                  ),
                                }))
                              }
                              className="flex-1 rounded-lg bg-green-500 py-1.5 text-xs font-medium text-white hover:bg-green-600"
                            >
                              {t("✓ 通过")}
                            </button>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id
                                      ? { ...i, reviewStatus: i.reviewStatus === "refine" ? ("pending" as const) : ("refine" as const) }
                                      : i,
                                  ),
                                }))
                              }
                              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
                                img.reviewStatus === "refine"
                                  ? "bg-yellow-400 text-white"
                                  : "border border-yellow-400 bg-white text-yellow-600"
                              }`}
                            >
                              {img.reviewStatus === "refine" ? t("收起精修") : t("✏️ 精修")}
                            </button>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "deleted" as const } : i,
                                  ),
                                }))
                              }
                              className="flex-1 rounded-lg border border-red-300 bg-white py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                            >
                              {t("🗑 删除")}
                            </button>
                          </div>
                        )}

                        {(img.reviewStatus === "archived" || img.reviewStatus === "done") && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-green-600">{t("✓ 已通过")}</span>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "pending" as const } : i,
                                  ),
                                }))
                              }
                              className="text-xs text-gray-400 underline hover:text-gray-600"
                            >
                              {t("撤回")}
                            </button>
                          </div>
                        )}

                        {img.reviewStatus === "refine" && (
                          <div className="flex gap-2 pt-1">
                            <input
                              className="flex-1 rounded-lg border border-yellow-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400"
                              placeholder={t("描述需要修改的地方…")}
                              value={refinePrompts[img.id] || ""}
                              onChange={(e) =>
                                setRefinePrompts((p) => ({ ...p, [img.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleRefine(img.id);
                                }
                              }}
                            />
                            <button
                              onClick={() => handleRefine(img.id)}
                              disabled={
                                refining === img.id ||
                                !selectedModelId ||
                                !(refinePrompts[img.id] || "").trim()
                              }
                              className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-40"
                            >
                              {refining === img.id ? t("精修中…") : t("执行")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(4)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("上一步")}
            </button>
            <button
              onClick={() => goToStep(6)}
              disabled={!ws.finalImages.some((i) => i.reviewStatus === "archived")}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {t("进入归档")} ({ws.finalImages.filter((i) => i.reviewStatus === "archived").length} {t("张已通过")})
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 6 · 审核归档")}</h2>

          {ws.finalImages.every((i) => i.reviewStatus !== "pending" && i.reviewStatus !== "archived") &&
            ws.archivedImageCount > 0 && (
              <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                <div className="text-lg font-semibold text-green-700">{t("🎉 归档完成！")}</div>
                <div className="text-sm text-green-600">
                  {t("已归档")} {ws.archivedImageCount} {t("张到成品图库「热点借势」")}
                </div>
                <div className="flex justify-center gap-3">
                  <a
                    href="/gallery"
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
                  >
                    {t("查看成品图库")}
                  </a>
                  <button
                    onClick={() => {
                      setWs(initialState);
                      setStep(1);
                      setSelectedModelId(null);
                      setExtraPrompt("");
                      setRefinePrompts({});
                    }}
                    className="rounded-lg border border-green-400 px-4 py-2 text-sm text-green-600 hover:bg-green-50"
                  >
                    {t("继续生产")}
                  </button>
                </div>
              </div>
            )}

          {ws.finalImages.filter((i) => i.reviewStatus === "archived").length > 0 && (
            <div>
              <div className="mb-3 text-sm font-medium text-gray-600">
                {t("待归档")}（{ws.finalImages.filter((i) => i.reviewStatus === "archived").length} {t("张已通过")}）
              </div>
              <div className="grid grid-cols-2 gap-4">
                {ws.finalImages
                  .filter((i) => i.reviewStatus === "archived")
                  .map((img) => {
                    const url = fullUrl(img.url);
                    return (
                      <div key={img.id} className="overflow-hidden rounded-xl border border-gray-200">
                        <img
                          src={url}
                          alt={t("待归档")}
                          className="w-full cursor-pointer hover:opacity-90"
                          onClick={() => setPreviewUrl(url)}
                        />
                        <div className="flex gap-2 p-2">
                          <button
                            onClick={() => handleArchive(img.id)}
                            disabled={archiving === img.id}
                            className="flex-1 rounded-lg bg-green-500 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-40"
                          >
                            {archiving === img.id ? t("归档中…") : t("确认归档")}
                          </button>
                          <button
                            onClick={() =>
                              setWs((p) => ({
                                ...p,
                                finalImages: p.finalImages.map((i) =>
                                  i.id === img.id ? { ...i, reviewStatus: "refine" as const } : i,
                                ),
                              }))
                            }
                            className="flex-1 rounded-lg border border-yellow-400 py-1.5 text-xs font-medium text-yellow-600 hover:bg-yellow-50"
                          >
                            {t("发回精修")}
                          </button>
                          <button
                            onClick={() =>
                              setWs((p) => ({
                                ...p,
                                finalImages: p.finalImages.map((i) =>
                                  i.id === img.id ? { ...i, reviewStatus: "deleted" as const } : i,
                                ),
                              }))
                            }
                            className="flex-1 rounded-lg border border-red-300 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                          >
                            {t("删除")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(5)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("返回 Step 5")}
            </button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt={t("预览")}
            className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute right-4 top-4 text-2xl text-white hover:text-gray-300"
            onClick={() => setPreviewUrl(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default function TrendingNewsWorkflowPage() {
  const { t } = useLanguage();
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-gray-500">{t("加载中…")}</div>}>
      <TrendingNewsWorkflowContent />
    </Suspense>
  );
}

// @ts-nocheck
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useLanguage } from "@workbench/lib/LanguageContext";
import DateTimeInput from "@workbench/components/common/DateTimeInput";
import { apiGet, apiPatch, apiPost } from "@workbench/lib/api";
import { getTagLabel } from "@workbench/lib/tag-display";
import { isImageGenerationModel } from "@workbench/lib/expression-workflow";

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

interface TrendingJob {
  id: number;
  session_id: number | null;
  task_id: number | null;
  news_title: string;
  topic_type: string;
  risk_level: string;
  allow_game_integration: boolean;
  selected_angle: string | null;
  selected_image_type: string | null;
  selected_action: string | null;
  copy_text: string | null;
  ad_size: string;
  image_language: string;
  draft_image_url: string | null;
  final_image_url: string | null;
  refined_image_url: string | null;
  status: string;
}

interface ReviewImage {
  id: string;
  url: string;
  reviewStatus: "pending" | "archived" | "refine" | "deleted" | "done";
  refinePrompt?: string;
}

interface WorkflowState {
  sessionId: number | null;
  newsTitle: string;
  publishTime: string;
  topicType: string;
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
  吃瓜: ["看新闻吃瓜", "吃瓜"],
  震惊: ["看新闻吃瓜", "看比赛"],
  无语: ["堵车烦躁", "看新闻吃瓜"],
  欢呼: ["赢牌欢呼", "看比赛"],
  崩溃: ["输牌倒地", "堵车烦躁"],
  紧张: ["看牌紧张", "看比赛"],
  偷笑: ["唱歌", "跳舞"],
  思考: ["堵车烦躁", "看新闻吃瓜"],
  困惑: ["堵车烦躁", "天气太热流汗"],
  开心: ["发薪日", "唱歌"],
  庆祝: ["发薪日", "跳舞"],
  邀请: ["唱歌", "跳舞"],
};

const TOPIC_TYPE_OPTIONS = [
  { value: "BREAKING_NEWS", label: "突发新闻" },
  { value: "SPORTS_EVENT", label: "体育赛事" },
  { value: "ENTERTAINMENT", label: "娱乐热点" },
  { value: "SOCIAL_TOPIC", label: "社会议题" },
  { value: "HOLIDAY_EVENT", label: "节日事件" },
];

const initialState: WorkflowState = {
  sessionId: null,
  newsTitle: "",
  publishTime: "",
  topicType: "",
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

function TrendingWorkflowContent() {
  const { t, lang } = useLanguage();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [ws, setWs] = useState<WorkflowState>(initialState);
  const [configs, setConfigs] = useState<TopicTypeConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    apiGet("/api/trending/topic-configs").then((res: any) => {
      if (res?.data) setConfigs(res.data);
    });
  }, []);

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
      .catch(() => setError(t("草稿恢复失败，已重置为初始状态")))
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
          workflow_type: "trending",
          mode: "full",
          current_step: currentStep,
          status,
          state_json: JSON.stringify(state),
        });
        if (res?.data?.id) {
          setWs((prev) => ({ ...prev, sessionId: res.data.id }));
        }
      } catch {}
    });
  };

  const goToStep = (n: number) => {
    autoSave(undefined, "draft", n);
    setStep(n);
  };

  const handleStep1Next = () => {
    if (!ws.newsTitle.trim() || !ws.topicType) {
      setError(t("请填写热点标题并选择热点分类"));
      return;
    }

    const cfg = configs.find((item) => item.topic_type === ws.topicType);
    if (!cfg) {
      setError(t("配置加载中，请稍候"));
      return;
    }

    setWs((prev) => ({
      ...prev,
      riskLevel: cfg.risk_level,
      allowGameIntegration: cfg.allow_game_integration,
      allowedAngles: cfg.allowed_angles,
      allowedImageTypes: cfg.allowed_image_types,
      allowedActions: cfg.allowed_actions,
      copyStyle: cfg.copy_style,
      configNotes: cfg.notes || "",
    }));
    setError("");
    goToStep(2);
  };

  const handleStep3Next = async () => {
    if (!ws.selectedAngle || !ws.selectedImageType || !ws.selectedAction) {
      setError(t("请选择借势角度、图片类型和牛动作"));
      return;
    }

    setError("");
    if (ws.jobId) {
      await apiPatch(`/api/trending/jobs/${ws.jobId}`, {
        selected_angle: ws.selectedAngle,
        selected_image_type: ws.selectedImageType,
        selected_action: ws.selectedAction,
        copy_text: ws.copyText,
      });
    }
    goToStep(4);
  };

  const createJob = async (): Promise<number | null> => {
    try {
      const res: any = await apiPost("/api/trending/jobs/create", {
        news_title: ws.newsTitle,
        publish_time: ws.publishTime || null,
        topic_type: ws.topicType,
        ad_size: ws.adSize,
        image_language: ws.imageLanguage,
        session_id: ws.sessionId,
      });
      if (res?.data?.id) {
        const job = res.data as TrendingJob;
        const jobId = job.id;
        await apiPatch(`/api/trending/jobs/${jobId}`, {
          selected_angle: ws.selectedAngle,
          selected_image_type: ws.selectedImageType,
          selected_action: ws.selectedAction,
          copy_text: ws.copyText,
        });
        setWs((prev) => ({ ...prev, jobId }));
        autoSave({ jobId });
        return jobId;
      }
    } catch (e: any) {
      setError(`${t("创建任务失败：")}${e?.message || t("未知错误")}`);
    }
    return null;
  };

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
  const [refTagFilter, setRefTagFilter] = useState("");
  const [refTags, setRefTags] = useState<string[]>([]);
  const [refLoading, setRefLoading] = useState(false);

  useEffect(() => {
    apiGet("/api/model-configs/available?purpose=image").then((res: any) => {
      if (res?.data) {
        const imageModels = res.data.filter((model: { name?: string; model_name?: string; provider?: string }) =>
          isImageGenerationModel(model),
        );
        setModels(imageModels);
        if (imageModels.length > 0 && !selectedModelId) {
          setSelectedModelId(imageModels[0].id);
        }
      }
    });
  }, [selectedModelId]);

  const fuzzyMatchTags = (tags: string[], action: string): string[] => {
    if (!action) return [];

    const exact = tags.filter((tag) => tag.includes(action));
    if (exact.length > 0) return exact;

    const hints = ACTION_TAG_HINTS[action] || [];
    const hinted = hints.filter((hint) => tags.includes(hint));
    if (hinted.length > 0) return hinted;

    const keywords = action.replace(/[的地得]/, "").split("").filter(Boolean);
    const fuzzy = tags.filter((tag) => keywords.some((kw) => tag.includes(kw)));
    return fuzzy;
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

  const loadRefTags = () => {
    apiGet("/api/assets/tags").then((res: any) => {
      if (res?.data) setRefTags(res.data.map((t: any) => t.name));
    });
  };

  const autoLoadByAction = (action: string, allTags: string[]) => {
    const matched = fuzzyMatchTags(allTags, action);
    if (matched.length > 0) {
      setRefTagFilter(matched[0]);
    } else {
      setRefTagFilter("");
    }
  };

  useEffect(() => {
    if (step === 4) {
      setRefLoading(true);
      apiGet("/api/assets/tags")
        .then((res: any) => {
          const tags = Array.from(new Set((res?.data?.map((t: any) => t.name) || []) as string[]));
          setRefTags(tags);
          autoLoadByAction(ws.selectedAction, tags);
        })
        .catch(() => {
          setRefTagFilter("");
        });
    }
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
        const newImages: ReviewImage[] = urls.map((url) => ({
          id: `${Date.now()}-${Math.random()}`,
          url,
          reviewStatus: "pending",
        }));
        setWs((prev) => {
          const updated = { ...prev, finalImages: [...prev.finalImages, ...newImages] };
          autoSave(updated);
          return updated;
        });
      } catch (e: any) {
        setError(`${t("第")} ${i + 1} ${t("张生成失败：")}${e?.message || t("未知错误")}`);
      }
      setGenerateProgress(i + 1);
    }
    setGenerating(false);
    autoSave();
  };

  const handleRefine = async (imgId: string) => {
    if (!ws.jobId || !selectedModelId) return;
    const prompt = refinePrompts[imgId];
    if (!prompt?.trim()) return;
    setRefining(imgId);
    setError("");
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
        setWs((prev) => {
          const updated = {
            ...prev,
            finalImages: prev.finalImages.map((img) =>
              img.id === imgId ? { ...img, url: urls[0], reviewStatus: "pending" as const } : img,
            ),
          };
          autoSave(updated);
          return updated;
        });
        setRefinePrompts((prev) => ({ ...prev, [imgId]: "" }));
      }
    } catch (e: any) {
      setError(`${t("精修失败：")}${e?.message || t("未知错误")}`);
    }
    setRefining(null);
  };

  const handleArchive = async (imgId: string) => {
    if (!ws.jobId) return;
    const img = ws.finalImages.find((item) => item.id === imgId);
    if (!img) return;
    setArchiving(imgId);
    setError("");
    try {
      await apiPost(`/api/trending/jobs/${ws.jobId}/archive`, {
        image_url: img.url,
      });
      setWs((prev) => {
        const newCount = prev.archivedImageCount + 1;
        const updated = {
          ...prev,
          archivedImageCount: newCount,
          finalImages: prev.finalImages.map((item) =>
            item.id === imgId ? { ...item, reviewStatus: "done" as const } : item,
          ),
        };
        const allDone = updated.finalImages.every(
          (item) =>
            item.reviewStatus !== "pending" &&
            item.reviewStatus !== "archived" &&
            item.reviewStatus !== "refine",
        );
        if (allDone && newCount > 0) {
          autoSave(updated, "completed");
        } else {
          autoSave(updated);
        }
        return updated;
      });
    } catch (e: any) {
      setError(`${t("归档失败：")}${e?.message || t("未知错误")}`);
    }
    setArchiving(null);
  };

  const ModelSelectorInline = ({
    selectedId,
    onChange,
  }: {
    selectedId: number | null;
    onChange: (id: number) => void;
  }) => (
    <select
      value={selectedId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      <option value="">{t("-- 选择模型 --")}</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );

  const steps = ["热点输入", "约束预览", "借势参数", "规格设置", "生成图片", "审核归档"];

  if (restoring) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        {t("恢复草稿中…")}
      </div>
    );
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
        <h1 className="text-xl font-bold text-gray-800">{t("热点借势图")}</h1>
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
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 1 · 热点输入")}</h2>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">{t("热点标题 *")}</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={t("输入新闻热点标题")}
              value={ws.newsTitle}
              onChange={(e) => setWs((prev) => ({ ...prev, newsTitle: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">{t("发布时间（选填）")}</label>
            <DateTimeInput
              value={ws.publishTime}
              onChange={(e) => setWs((prev) => ({ ...prev, publishTime: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">{t("热点分类 *")}</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TOPIC_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setWs((prev) => ({ ...prev, topicType: opt.value }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    ws.topicType === opt.value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(opt.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleStep1Next}
              disabled={!ws.newsTitle.trim() || !ws.topicType}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-40"
            >
              {t("下一步")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 2 · 约束预览")}</h2>
          <p className="text-xs text-gray-400">{t("本配置由系统自动生成，不可在此修改。如需调整请联系管理员。")}</p>

          <div className="grid grid-cols-3 gap-3">
            <div
              className={`rounded-lg border p-3 text-center ${
                RISK_COLORS[ws.riskLevel] || "bg-gray-50 text-gray-600"
              }`}
            >
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
              <span className="text-gray-700">
                {ws.allowedAngles.map((a) => t(ANGLE_LABELS[a] || a)).join(" / ")}
              </span>
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
              <div className="mt-2 rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700">
                ⚠️ {ws.configNotes}
              </div>
            )}
          </div>

          {!ws.allowGameIntegration && (
            <div className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
              {t("🚫 本热点类型禁止生成任何游戏相关内容")}
            </div>
          )}

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
              placeholder={t("输入配套文案，留空则由 AI 自动生成")}
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
              onClick={handleStep3Next}
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
              {AD_SIZES.map((size) => (
                <button
                  key={size.value}
                  onClick={() => setWs((prev) => ({ ...prev, adSize: size.value }))}
                  className={`rounded-lg border px-4 py-2 text-left text-sm transition-all ${
                    ws.adSize === size.value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(size.label)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">{t("图片文字语言")}</label>
            <div className="flex gap-2">
              {LANGUAGES.map((language) => (
                <button
                  key={language.value}
                  onClick={() => setWs((prev) => ({ ...prev, imageLanguage: language.value }))}
                  className={`rounded-lg border px-4 py-2 text-sm transition-all ${
                    ws.imageLanguage === language.value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  {t(language.label)}
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
                  {t("暂无 hot_topic 分类素材，请先在素材库上传")}
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
                          selected
                            ? "border-blue-500 ring-2 ring-blue-300"
                            : "border-transparent hover:border-gray-300"
                        }`}
                      >
                        <img
                          src={`${"/api/workbench"}${asset.url}`}
                          alt={asset.name || t("参考图")}
                          className="aspect-square w-full object-cover"
                        />
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
                            src={`${"/api/workbench"}${asset.url}`}
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

            <div className="space-y-1 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
            <div className="mb-2 font-medium text-blue-700">{t("当前配置摘要")}</div>
            <div>
              <span className="text-gray-500">{t("热点：")}</span>
              {ws.newsTitle}
            </div>
            <div>
              <span className="text-gray-500">{t("分类：")}</span>
              {t(TOPIC_TYPE_OPTIONS.find((item) => item.value === ws.topicType)?.label || "")}
            </div>
            <div>
              <span className="text-gray-500">{t("角度：")}</span>
              {t(ANGLE_LABELS[ws.selectedAngle] || ws.selectedAngle)}
            </div>
            <div>
              <span className="text-gray-500">{t("类型：")}</span>
              {t(IMAGE_TYPE_LABELS[ws.selectedImageType] || ws.selectedImageType)}
            </div>
            <div>
              <span className="text-gray-500">{t("动作：")}</span>
              {ws.selectedAction}
            </div>
            <div>
              <span className="text-gray-500">{t("尺寸：")}</span>
              {ws.adSize}
            </div>
            <div>
              <span className="text-gray-500">{t("语言：")}</span>
              {t(LANGUAGES.find((item) => item.value === ws.imageLanguage)?.label || "")}
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
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-700">{t("Step 5 · 生成图片")}</h2>
            {ws.finalImages.some((img) => img.reviewStatus === "refine") && (
              <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded-full">
                {ws.finalImages.filter((i) => i.reviewStatus === "refine").length} {t("张待精修")}
              </span>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">{t("选择模型")}</label>
            <ModelSelectorInline
              selectedId={selectedModelId}
              onChange={setSelectedModelId}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">{t("出图数量")}</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setGenerateCount(n)}
                  className={`w-10 h-10 rounded-lg border text-sm font-medium transition-all
                    ${generateCount === n ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-600 hover:border-blue-400"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">{t("额外描述（选填）")}</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={t("补充说明，追加到 Prompt 末尾")}
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
            />
          </div>

          <button
            onClick={() => handleGenerate()}
            disabled={generating || !selectedModelId || !ws.jobId}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-all"
          >
            {generating ? `${t("生成中")} ${generateProgress}/${generateCount}…` : t("生成图片")}
          </button>

          {ws.finalImages.length > 0 && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-gray-600">{t("生成结果")}</div>
              {ws.finalImages
                .filter((img) => img.reviewStatus !== "deleted")
                .map((img) => {
                  const fullUrl = img.url.startsWith("http")
                    ? img.url
                    : `${"/api/workbench"}${img.url}`;
                  return (
                    <div
                      key={img.id}
                      className={`border rounded-xl overflow-hidden transition-all
                        ${img.reviewStatus === "refine" ? "border-yellow-400 ring-2 ring-yellow-200" : "border-gray-200"}`}
                    >
                      <img
                        src={fullUrl}
                        alt={t("生成图")}
                        className="w-full cursor-pointer hover:opacity-95"
                        onClick={() => setPreviewUrl(fullUrl)}
                      />

                      <div className="p-3 bg-gray-50 border-t border-gray-100 space-y-2">
                        {img.reviewStatus !== "archived" && (
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "archived" as const } : i
                                  ),
                                }))
                              }
                              className="flex-1 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600 transition-all"
                            >
                              {t("✓ 通过")}
                            </button>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id
                                      ? { ...i, reviewStatus: i.reviewStatus === "refine" ? "pending" as const : "refine" as const }
                                      : i
                                  ),
                                }))
                              }
                              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all
                                ${img.reviewStatus === "refine"
                                  ? "bg-yellow-400 text-white hover:bg-yellow-500"
                                  : "bg-white border border-yellow-400 text-yellow-600 hover:bg-yellow-50"}`}
                            >
                              {img.reviewStatus === "refine" ? t("收起精修") : t("✏️ 精修")}
                            </button>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "deleted" as const } : i
                                  ),
                                }))
                              }
                              className="flex-1 py-1.5 bg-white border border-red-300 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50 transition-all"
                            >
                              {t("🗑 删除")}
                            </button>
                          </div>
                        )}

                        {img.reviewStatus === "archived" && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-green-600 font-medium">{t("✓ 已通过，将在下一步归档")}</span>
                            <button
                              onClick={() =>
                                setWs((p) => ({
                                  ...p,
                                  finalImages: p.finalImages.map((i) =>
                                    i.id === img.id ? { ...i, reviewStatus: "pending" as const } : i
                                  ),
                                }))
                              }
                              className="text-xs text-gray-400 hover:text-gray-600 underline"
                            >
                              {t("撤回")}
                            </button>
                          </div>
                        )}

                        {img.reviewStatus === "refine" && (
                          <div className="flex gap-2 pt-1">
                            <input
                              className="flex-1 border border-yellow-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400"
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
                              disabled={refining === img.id || !selectedModelId || !(refinePrompts[img.id] || "").trim()}
                              className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-yellow-600 transition-all"
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
            <button onClick={() => goToStep(4)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              {t("上一步")}
            </button>
            <button
              onClick={() => goToStep(6)}
              disabled={!ws.finalImages.some((i) => i.reviewStatus === "archived")}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-blue-700"
            >
              {t("进入归档")} ({ws.finalImages.filter((i) => i.reviewStatus === "archived").length} {t("张已通过")})
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-700">{t("Step 6 · 审核归档")}</h2>

          {ws.finalImages.every((i) => i.reviewStatus !== "pending" && i.reviewStatus !== "archived") &&
            ws.archivedImageCount > 0 && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center space-y-3">
              <div className="text-green-700 font-semibold text-lg">{t("🎉 归档完成！")}</div>
              <div className="text-sm text-green-600">
                {t("已归档")} {ws.archivedImageCount} {t("张图片到成品图库「热点借势」")}
              </div>
              <div className="flex justify-center gap-3">
                <a
                  href="/workbench/gallery"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
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
                  className="px-4 py-2 border border-green-400 text-green-600 rounded-lg text-sm hover:bg-green-50"
                >
                  {t("继续生产")}
                </button>
              </div>
            </div>
          )}

          {ws.finalImages.filter((i) => i.reviewStatus === "archived").length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-600 mb-3">
                {t("待归档")}（{ws.finalImages.filter((i) => i.reviewStatus === "archived").length} {t("张已通过")}）
              </div>
              <div className="grid grid-cols-2 gap-4">
                {ws.finalImages
                  .filter((i) => i.reviewStatus === "archived")
                  .map((img) => {
                    const fullUrl = img.url.startsWith("http")
                      ? img.url
                      : `${"/api/workbench"}${img.url}`;
                    return (
                      <div key={img.id} className="border border-gray-200 rounded-xl overflow-hidden">
                        <img
                          src={fullUrl}
                          alt={t("待归档")}
                          className="w-full cursor-pointer hover:opacity-90"
                          onClick={() => setPreviewUrl(fullUrl)}
                        />
                        <div className="p-2 flex gap-2">
                          <button
                            onClick={() => handleArchive(img.id)}
                            disabled={archiving === img.id}
                            className="flex-1 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-green-600"
                          >
                            {archiving === img.id ? t("归档中…") : t("确认归档")}
                          </button>
                          <button
                            onClick={() =>
                              setWs((p) => ({
                                ...p,
                                finalImages: p.finalImages.map((i) =>
                                  i.id === img.id ? { ...i, reviewStatus: "refine" as const } : i
                                ),
                              }))
                            }
                            className="flex-1 py-1.5 border border-yellow-400 text-yellow-600 rounded-lg text-xs font-medium hover:bg-yellow-50"
                          >
                            {t("发回精修")}
                          </button>
                          <button
                            onClick={() =>
                              setWs((p) => ({
                                ...p,
                                finalImages: p.finalImages.map((i) =>
                                  i.id === img.id ? { ...i, reviewStatus: "deleted" as const } : i
                                ),
                              }))
                            }
                            className="flex-1 py-1.5 border border-red-300 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50"
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

          {ws.archivedImageCount > 0 &&
            ws.finalImages.some((i) => i.reviewStatus === "archived") === false && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {t("✓ 已成功归档")} {ws.archivedImageCount} {t("张到成品图库")}
            </div>
          )}

          {ws.finalImages.filter((i) => i.reviewStatus === "refine").length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
              {t("⚠️ 有")} {ws.finalImages.filter((i) => i.reviewStatus === "refine").length} {t("张图发回精修，请返回 Step 5 处理")}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => goToStep(5)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
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
            src={
              previewUrl && previewUrl.startsWith("http")
                ? previewUrl
                : `${"/api/workbench"}${previewUrl}`
            }
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

export default function TrendingWorkflowPage() {
  const { t } = useLanguage();
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-gray-500">
          {t("页面加载中…")}
        </div>
      }
    >
      <TrendingWorkflowContent />
    </Suspense>
  );
}

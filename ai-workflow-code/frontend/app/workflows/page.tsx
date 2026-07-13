"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

type SessionStatus = "draft" | "completed";
type SessionMode = "full" | "retouch";

interface WorkflowSession {
  id: number;
  session_id: number;
  workflow_type: string;
  mode: SessionMode | string;
  status: SessionStatus | string;
  current_step: number;
  state_json?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const STATUS_TABS: Array<{ value: SessionStatus; label: string }> = [
  { value: "draft", label: "草稿" },
  { value: "completed", label: "已完成" },
];

const MODE_TABS: Array<{ value: SessionMode; label: string }> = [
  { value: "full", label: "完整流程" },
  { value: "retouch", label: "直接精修" },
];

function parseState(session: WorkflowSession): Record<string, any> {
  try {
    return session.state_json ? JSON.parse(session.state_json) : {};
  } catch {
    return {};
  }
}

function sessionTitle(session: WorkflowSession, t: (value: string) => string) {
  const state = parseState(session);
  if (session.workflow_type === "daily_post") {
    return state.taskName || `${t("日常互动图")} #${session.session_id || session.id}`;
  }
  if (session.workflow_type === "trending") {
    return state.newsTitle || state.taskName || `${t("热点借势图")} #${session.session_id || session.id}`;
  }
  if (session.workflow_type === "trending_news") {
    return (
      state.selectedNewsTask?.title ||
      state.newsTitle ||
      state.taskName ||
      `${t("热点借势·新闻")} #${session.session_id || session.id}`
    );
  }
  if (session.workflow_type === "activity") {
    return state.taskName || `${t("活动图生产")} #${session.session_id || session.id}`;
  }
  if (session.workflow_type === "background") {
    return state.taskName || state.purpose || `${t("背景图生成")} #${session.session_id || session.id}`;
  }
  return state.taskName || `${t("表情制作")} #${session.session_id || session.id}`;
}

function workflowTypeLabel(type: string, t: (value: string) => string) {
  const labels: Record<string, string> = {
    expression: "表情制作",
    activity: "活动图生产",
    daily_post: "日常互动图",
    trending: "热点借势图",
    trending_news: "热点借势·新闻",
    background: "背景图生成",
  };
  return type in labels ? t(labels[type]) : type;
}

function getSessionHref(session: WorkflowSession): string {
  const sessionId = session.session_id || session.id;
  if (session.workflow_type === "daily_post") {
    return `/workflows/daily-post?session_id=${sessionId}`;
  }
  if (session.workflow_type === "trending") {
    return `/workflows/trending?session_id=${sessionId}`;
  }
  if (session.workflow_type === "trending_news") {
    return `/workflows/trending-news?session_id=${sessionId}`;
  }
  if (session.workflow_type === "activity") {
    return `/workflows/activity?session_id=${sessionId}`;
  }
  if (session.workflow_type === "background") {
    return `/workflows/background?session_id=${sessionId}`;
  }
  return `/workflows/expression?session_id=${sessionId}`;
}

function getCompletedSessionHref(session: WorkflowSession): string {
  if (
    session.workflow_type === "activity" ||
    session.workflow_type === "background" ||
    session.workflow_type === "daily_post" ||
    session.workflow_type === "trending" ||
    session.workflow_type === "trending_news"
  ) {
    return getSessionHref(session);
  }
  return `${getSessionHref(session)}&step=9`;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function sessionProgressLabel(session: WorkflowSession, t: (value: string) => string) {
  if (session.status === "completed") {
    return t("已完成");
  }
  const state = parseState(session);
  const step = Number(state.step || session.current_step || 1);
  return `${t("第")} ${step} ${t("步")}`;
}

function sessionCurrentStepLabel(session: WorkflowSession, t: (value: string) => string) {
  const state = parseState(session);
  const step = Number(state.step || session.current_step || 1);
  return `${t("第")} ${step} ${t("步")}`;
}

function sessionCompletedTime(session: WorkflowSession) {
  return formatTime(session.updated_at || session.created_at);
}

function resetStateForCopy(source: Record<string, any>, mode: SessionMode, t: (value: string) => string) {
  const workflowMode = mode === "retouch" ? "refine" : "full";
  const currentStep = mode === "retouch" ? 6 : 1;
  return {
    ...source,
    sessionId: null,
    mode: workflowMode,
    maxVisitedStep: currentStep,
    taskId: null,
    taskName: `${source.taskName || t("表情制作")} ${t("复制")}`,
    draftImages: [],
    selectedDraftImageIds: [],
    uploadedRefineImages: [],
    finalImages: [],
    finalGeneratedCount: 0,
    confirmedImages: [],
    toRefineImages: [],
    consistencyImages: [],
    refinedImageCount: 0,
    confirmedFinalImageIds: [],
    archivedImageCount: 0,
    archived: false,
  };
}

export default function WorkflowsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>("draft");
  const [mode, setMode] = useState<SessionMode>("full");
  const [sessions, setSessions] = useState<WorkflowSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const emptyText = useMemo(() => {
    const statusText = status === "draft" ? t("草稿") : t("已完成任务");
    const modeText = mode === "full" ? t("完整流程") : t("直接精修");
    return `${t("暂无")}${modeText}${statusText}`;
  }, [mode, status, t]);

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<WorkflowSession[]>(
        `/api/workflow-sessions?status=${status}&mode=${mode}`,
      );
      if (res.code !== 0) throw new Error(res.msg || t("工作流任务加载失败"));
      setSessions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("工作流任务加载失败"));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, [status, mode]);

  async function deleteSession(session: WorkflowSession) {
    setWorkingId(session.session_id || session.id);
    setError("");
    setMessage("");
    try {
      const res = await apiDelete(`/api/workflow-sessions/${session.session_id || session.id}`);
      if (res.code !== 0) throw new Error(res.msg || t("删除失败"));
      setMessage(t("草稿已删除"));
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("删除失败"));
    } finally {
      setWorkingId(null);
    }
  }

  async function copySession(session: WorkflowSession, targetMode: SessionMode) {
    const sessionId = session.session_id || session.id;
    setWorkingId(sessionId);
    setError("");
    setMessage("");
    try {
      const detailRes = await apiGet<WorkflowSession>(`/api/workflow-sessions/${sessionId}`);
      if (detailRes.code !== 0 || !detailRes.data) throw new Error(detailRes.msg || t("复制源加载失败"));
      const nextState = resetStateForCopy(parseState(detailRes.data), targetMode, t);
      const currentStep = targetMode === "retouch" ? 6 : 1;
      const createRes = await apiPost<WorkflowSession>("/api/workflow-sessions/save", {
        workflow_type: "expression",
        mode: targetMode,
        status: "draft",
        current_step: currentStep,
        state_json: JSON.stringify(nextState),
        task_id: null,
      });
      if (createRes.code !== 0 || !createRes.data?.session_id) {
        throw new Error(createRes.msg || t("复制失败"));
      }
      const newSessionId = createRes.data.session_id;
      const stateWithSession = { ...nextState, sessionId: newSessionId };
      await apiPost<WorkflowSession>("/api/workflow-sessions/save", {
        session_id: newSessionId,
        workflow_type: "expression",
        mode: targetMode,
        status: "draft",
        current_step: currentStep,
        state_json: JSON.stringify(stateWithSession),
        task_id: null,
      });
      router.push(`/workflows/expression?session_id=${newSessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("复制失败"));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("工作流任务")} description={t("管理表情制作、活动图生产、背景图生成草稿和已完成工作流")} />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setStatus(item.value)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              status === item.value
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {MODE_TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setMode(item.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === item.value
                ? "bg-gray-100 text-gray-900"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">{t("任务名")}</th>
              <th className="px-4 py-3">{t("工作流类型")}</th>
              <th className="px-4 py-3">{t("进度")}</th>
              <th className="px-4 py-3">{t("创建时间")}</th>
              <th className="px-4 py-3 text-right">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  {t("正在加载...")}
                </td>
              </tr>
            ) : safeSessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              safeSessions.map((session) => {
                const sessionId = session.session_id || session.id;
                const busy = workingId === sessionId;
                return (
                  <tr key={sessionId}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {session.workflow_type === "daily_post" ? `#${sessionId}` : sessionTitle(session, t)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          session.workflow_type === "daily_post"
                            ? "bg-emerald-50 text-emerald-600"
                            : session.workflow_type === "trending"
                              ? "bg-orange-100 text-orange-700"
                              : session.workflow_type === "trending_news"
                                ? "bg-red-100 text-red-700"
                            : session.workflow_type === "activity"
                              ? "bg-blue-50 text-blue-600"
                              : session.workflow_type === "background"
                                ? "bg-violet-50 text-violet-600"
                                : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {workflowTypeLabel(session.workflow_type, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {status === "completed" && session.workflow_type === "daily_post"
                        ? sessionCompletedTime(session)
                        : session.workflow_type === "daily_post"
                          ? sessionCurrentStepLabel(session, t)
                          : sessionProgressLabel(session, t)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {status === "completed" && session.workflow_type === "daily_post"
                        ? formatTime(session.created_at)
                        : formatTime(session.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {status === "draft" ? (
                          <>
                            <Link
                              href={getSessionHref(session)}
                              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              {t("继续")}
                            </Link>
                            <button
                              type="button"
                              onClick={() => deleteSession(session)}
                              disabled={busy}
                              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("删除")}
                            </button>
                          </>
                        ) : (
                          <>
                            <Link
                              href={getCompletedSessionHref(session)}
                              className="rounded-md border border-gray-900 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                            >
                              {session.workflow_type === "daily_post" ? t("查看") : t("查看/补充归档")}
                            </Link>
                            {session.workflow_type === "expression" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => copySession(session, "full")}
                                  disabled={busy}
                                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {t("复制为完整流程")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copySession(session, "retouch")}
                                  disabled={busy}
                                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {t("复制为精修")}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

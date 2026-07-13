// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiGet, apiPost } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { REVIEW_CHECKLIST } from "@workbench/lib/constants";

interface PendingReviewImage {
  image_id: number;
  task_id: number;
  image_url: string;
  status: string;
}

interface ReviewResponse {
  id: number;
  image_id: number;
  score: number;
  status: "pass" | "reject";
}

export default function ReviewPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<PendingReviewImage[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [score, setScore] = useState(80);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeItems = Array.isArray(items) ? items : [];
  const safeReviewChecklist = Array.isArray(REVIEW_CHECKLIST) ? REVIEW_CHECKLIST : [];

  const selected = useMemo(
    () => safeItems.find((item) => item.image_id === selectedId) || safeItems[0] || null,
    [safeItems, selectedId],
  );

  useEffect(() => {
    let active = true;

    async function loadPending() {
      setLoading(true);
      setError("");

      try {
        const res = await apiGet<PendingReviewImage[]>("/api/review/pending");
        if (!active) return;

        if (res.code !== 0) {
          setError(res.msg || t("待审核图片加载失败"));
          return;
        }

        const nextItems = Array.isArray(res.data) ? res.data : [];
        setItems(nextItems);
        setSelectedId(nextItems[0]?.image_id || null);
      } catch {
        if (active) setError(t("无法连接后端服务"));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPending();

    return () => {
      active = false;
    };
  }, []);

  function toggleChecklist(key: string) {
    setCheckedItems((current) => ({ ...current, [key]: !current[key] }));
  }

  function resetForm() {
    setCheckedItems({});
    setScore(80);
    setRejectReason("");
    setShowRejectReason(false);
  }

  async function submitReview(status: "pass" | "reject") {
    if (!selected) return;
    if (status === "reject" && !showRejectReason) {
      setShowRejectReason(true);
      return;
    }
      if (status === "reject" && !rejectReason.trim()) {
      setError(t("驳回时需要填写原因"));
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const tags = safeReviewChecklist.filter((item) => checkedItems[item.key]).map(
        (item) => item.key,
      );
      const res = await apiPost<ReviewResponse>("/api/review/submit", {
        image_id: selected.image_id,
        score,
        status,
        reason: status === "reject" ? rejectReason.trim() : undefined,
        tags,
      });

      if (res.code !== 0) {
        setError(res.msg || t("提交审核失败"));
        return;
      }

      const remaining = safeItems.filter((item) => item.image_id !== selected.image_id);
      setItems(remaining);
      setSelectedId(remaining[0]?.image_id || null);
      resetForm();
      setMessage(status === "pass" ? t("审核已通过") : t("审核已驳回"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("审核中心")} description={t("检查定稿图片质量并提交审核结论")} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          {t("正在加载待审核图片...")}
        </div>
      ) : !selected ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {t("暂无待审核图片")}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="overflow-hidden rounded-lg bg-gray-100">
              <img
                src={selected.image_url}
                alt={`Review image ${selected.image_id}`}
                className="max-h-[640px] w-full object-contain"
              />
            </div>

            {safeItems.length > 1 && (
              <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                {safeItems.map((item) => (
                  <button
                    key={item.image_id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.image_id);
                      resetForm();
                    }}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border ${
                      item.image_id === selected.image_id
                        ? "border-gray-900"
                        : "border-gray-200"
                    }`}
                  >
                    <img
                      src={item.image_url}
                      alt={`Review thumbnail ${item.image_id}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="border-b border-gray-100 pb-4">
              <h2 className="text-base font-semibold text-gray-900">{t("审核操作")}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t("图片")} #{selected.image_id}，{t("任务")} #{selected.task_id}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {safeReviewChecklist.map((item) => (
                <label key={item.key} className="flex items-center gap-3 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(checkedItems[item.key])}
                    onChange={() => toggleChecklist(item.key)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  {t(item.label)}
                </label>
              ))}
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700" htmlFor="review-score">
                {t("评分")}
              </label>
              <input
                id="review-score"
                type="number"
                min="0"
                max="100"
                value={score}
                onChange={(event) => setScore(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>

            {showRejectReason && (
              <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3">
                <label className="block text-sm font-medium text-red-700" htmlFor="reject-reason">
                  {t("驳回原因")}
                </label>
                <textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  className="mt-2 block min-h-24 w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  placeholder={t("说明需要重做或修正的问题")}
                />
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => submitReview("reject")}
                disabled={submitting}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("驳回")}
              </button>
              <button
                type="button"
                onClick={() => submitReview("pass")}
                disabled={submitting}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {t("通过")}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

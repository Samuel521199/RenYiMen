"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import PageHeader from "@/components/common/PageHeader";
import { apiPost } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import { TASK_SCENES, TASK_SIZES } from "@/lib/constants";
import type { Task, TaskScene, TaskSize } from "@/lib/types";

interface TaskFormState {
  title: string;
  scene: TaskScene;
  size: TaskSize;
  purpose: string;
  budget: string;
}

export default function CreateTaskPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const safeTaskScenes = Array.isArray(TASK_SCENES) ? TASK_SCENES : [];
  const safeTaskSizes = Array.isArray(TASK_SIZES) ? TASK_SIZES : [];
  const initialScene = safeTaskScenes[0]?.value as TaskScene;
  const initialSize = safeTaskSizes[0]?.value as TaskSize;
  const [form, setForm] = useState<TaskFormState>({
    title: "",
    scene: initialScene,
    size: initialSize,
    purpose: "",
    budget: "0",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const budgetValue = useMemo(() => {
    const value = Number(form.budget);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }, [form.budget]);

  function updateField<Key extends keyof TaskFormState>(key: Key, value: TaskFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await apiPost<Task>("/api/tasks/create", {
        title: form.title.trim(),
        scene: form.scene,
        size: form.size,
        purpose: form.purpose.trim(),
        description: form.purpose.trim(),
        budget: budgetValue,
      });

      if (res.code !== 0) {
        setError(res.msg || t("创建任务失败"));
        return;
      }

      router.push("/tasks");
    } catch {
      setError(t("无法连接后端服务，请稍后重试"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("创建任务")} description={t("填写图片生产任务的基础信息和预算")} />

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="title">
              {t("标题")}
            </label>
            <input
              id="title"
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              placeholder={t("例如：Tongits 周末活动主视觉")}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="scene">
              {t("场景")}
            </label>
            <select
              id="scene"
              value={form.scene}
              onChange={(event) => updateField("scene", event.target.value as TaskScene)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              {safeTaskScenes.map((scene) => (
                <option key={scene.value} value={scene.value}>
              {t(scene.label)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="size">
              {t("尺寸")}
            </label>
            <select
              id="size"
              value={form.size}
              onChange={(event) => updateField("size", event.target.value as TaskSize)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              {safeTaskSizes.map((size) => (
                <option key={size.value} value={size.value}>
              {t(size.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="purpose">
              {t("主题描述")}
            </label>
            <textarea
              id="purpose"
              value={form.purpose}
              onChange={(event) => updateField("purpose", event.target.value)}
              className="mt-1 block min-h-28 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              placeholder={t("描述活动主题、目标用户、画面氛围或必须出现的元素")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="budget">
              {t("预算")}
            </label>
            <input
              id="budget"
              type="number"
              min="0"
              step="0.01"
              value={form.budget}
              onChange={(event) => updateField("budget", event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
          <Link
            href="/tasks"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {t("取消")}
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {submitting ? t("创建中...") : t("创建任务")}
          </button>
        </div>
      </form>
    </div>
  );
}

// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";

type ShareGameInstruction = {
  id: number;
  game_type: string;
  label: string;
  content: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
};

type FormState = {
  label: string;
  content: string;
  sort_order: number;
};

const EMPTY_FORM: FormState = {
  label: "",
  content: "",
  sort_order: 0,
};

function summarizeContent(content: string) {
  return content.length > 50 ? `${content.slice(0, 50)}...` : content;
}

export default function ShareInstructionsPage() {
  const { t } = useLanguage();
  const [gameTypes, setGameTypes] = useState<string[]>([]);
  const [activeGameType, setActiveGameType] = useState("Tongits");
  const [editingGameType, setEditingGameType] = useState<string | null>(null);
  const [editingGameTypeValue, setEditingGameTypeValue] = useState("");
  const [editingGameTypeError, setEditingGameTypeError] = useState("");
  const [renamingGameType, setRenamingGameType] = useState(false);
  const [items, setItems] = useState<ShareGameInstruction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showGameForm, setShowGameForm] = useState(false);
  const [newGameType, setNewGameType] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingId) || null,
    [editingId, items],
  );

  async function loadGameTypes(nextGameType?: string) {
    try {
      const res = await apiGet<string[]>("/api/share/game-types");
      const items = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      setGameTypes(items);
      if (items.length > 0) {
        setActiveGameType((current) => {
          if (nextGameType && items.includes(nextGameType)) return nextGameType;
          if (items.includes(current)) return current;
          return items[0];
        });
      }
    } catch {
      setGameTypes([]);
    }
  }

  async function loadInstructions(gameType: string) {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<ShareGameInstruction[]>(
        `/api/share/game-instructions?game_type=${gameType}&include_disabled=true`,
      );
      if (res.code !== 0 || !Array.isArray(res.data)) {
        throw new Error(res.msg || t("指令列表加载失败"));
      }
      setItems(res.data);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : t("指令列表加载失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGameTypes();
  }, []);

  useEffect(() => {
    if (!activeGameType) {
      setItems([]);
      return;
    }
    void loadInstructions(activeGameType);
  }, [activeGameType]);

  function openCreateForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMessage("");
    setError("");
  }

  function openEditForm(item: ShareGameInstruction) {
    setEditingId(item.id);
    setForm({
      label: item.label,
      content: item.content,
      sort_order: item.sort_order,
    });
    setShowForm(true);
    setMessage("");
    setError("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function closeGameForm() {
    setShowGameForm(false);
    setNewGameType("");
  }

  function openRenameGameType(gameType: string) {
    setEditingGameType(gameType);
    setEditingGameTypeValue(gameType);
    setEditingGameTypeError("");
    closeForm();
    closeGameForm();
    setMessage("");
  }

  function cancelRenameGameType() {
    setEditingGameType(null);
    setEditingGameTypeValue("");
    setEditingGameTypeError("");
  }

  async function handleSubmit() {
    if (!form.label.trim() || !form.content.trim()) {
      setError(t("请先填写 label 和 content"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editingId === null) {
        const res = await apiPost<ShareGameInstruction>("/api/share/game-instructions", {
          game_type: activeGameType,
          label: form.label.trim(),
          content: form.content.trim(),
          sort_order: Number(form.sort_order) || 0,
        });
        if (res.code !== 0) {
          throw new Error(res.msg || t("创建失败"));
        }
        setMessage(t("创建成功"));
      } else {
        const res = await apiPut<ShareGameInstruction>(`/api/share/game-instructions/${editingId}`, {
          label: form.label.trim(),
          content: form.content.trim(),
          sort_order: Number(form.sort_order) || 0,
        });
        if (res.code !== 0) {
          throw new Error(res.msg || t("更新失败"));
        }
        setMessage(t("更新成功"));
      }
      closeForm();
      await loadInstructions(activeGameType);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item: ShareGameInstruction) {
    setError("");
    setMessage("");
    const res = await apiPatch<ShareGameInstruction>(`/api/share/game-instructions/${item.id}/toggle`, {});
    if (res.code !== 0) {
      setError(res.msg || t("切换失败"));
      return;
    }
    setMessage(item.enabled ? t("已禁用") : t("已启用"));
    await loadInstructions(activeGameType);
  }

  async function handleDelete(item: ShareGameInstruction) {
    if (!window.confirm(`${t("确定删除")}「${item.label}」${t("吗？")}`)) {
      return;
    }
    setError("");
    setMessage("");
    const res = await apiDelete(`/api/share/game-instructions/${item.id}`);
    if (res.code !== 0) {
      setError(res.msg || t("删除失败"));
      return;
    }
    setMessage(t("删除成功"));
    await loadInstructions(activeGameType);
  }

  async function handleCreateGameType() {
    const gameType = newGameType.trim();
    if (!gameType) {
      setError(t("请先填写游戏名称"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<ShareGameInstruction>("/api/share/game-instructions", {
        game_type: gameType,
        label: t("默认指令"),
        content: `Include ${gameType} game elements.`,
        sort_order: 0,
      });
      if (res.code !== 0) {
        throw new Error(res.msg || t("新增游戏失败"));
      }
      await loadGameTypes(gameType);
      closeGameForm();
      setMessage(t("新增游戏成功"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("新增游戏失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameGameType() {
    const oldGameType = editingGameType?.trim() || "";
    const newGameType = editingGameTypeValue.trim();
    if (!oldGameType || !newGameType) {
      setEditingGameTypeError(t("游戏名称不能为空"));
      return;
    }
    setRenamingGameType(true);
    setEditingGameTypeError("");
    setError("");
    setMessage("");
    try {
      const res = await apiPut<{ old: string; new: string }>("/api/share/game-types/rename", {
        old_game_type: oldGameType,
        new_game_type: newGameType,
      });
      if (res.code !== 0) {
        throw new Error(res.msg || t("重命名失败"));
      }
      await loadGameTypes(newGameType);
      if (activeGameType === oldGameType) {
        setActiveGameType(newGameType);
      }
      cancelRenameGameType();
      setMessage(t("游戏名称已更新"));
    } catch (err) {
      setEditingGameTypeError(err instanceof Error ? err.message : t("重命名失败"));
    } finally {
      setRenamingGameType(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("转发图游戏指令库")}
        description={t("按游戏类型维护转发图生成时可选的游戏场景/品牌/赢牌指令。")}
      />

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900">{t("游戏类型")}</p>
            <button
              type="button"
              onClick={() => {
                closeForm();
                setShowGameForm((current) => !current);
              }}
              className="text-xs font-medium text-gray-600 transition hover:text-gray-900"
            >
              {t("+ 新增游戏")}
            </button>
          </div>
          {showGameForm ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <input
                type="text"
                value={newGameType}
                onChange={(event) => setNewGameType(event.target.value)}
                placeholder={t("游戏名称，例如 LuckyNine")}
                className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-400"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateGameType()}
                  disabled={saving}
                  className="rounded-full bg-gray-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? t("提交中...") : t("确认")}
                </button>
                <button
                  type="button"
                  onClick={closeGameForm}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                >
                  {t("取消")}
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {gameTypes.map((gameType) => {
              const active = activeGameType === gameType;
              const isEditing = editingGameType === gameType;
              return (
                <div
                  key={gameType}
                  className={`rounded-2xl border px-3 py-3 transition ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editingGameTypeValue}
                        onChange={(event) => setEditingGameTypeValue(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRenameGameType()}
                          disabled={renamingGameType}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {renamingGameType ? t("保存中…") : t("确认")}
                        </button>
                        <button
                          type="button"
                          onClick={cancelRenameGameType}
                          className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-current transition hover:border-gray-400"
                        >
                          {t("取消")}
                        </button>
                      </div>
                      {editingGameTypeError ? (
                        <p className={`text-xs ${active ? "text-red-200" : "text-red-600"}`}>{editingGameTypeError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveGameType(gameType);
                          closeForm();
                          closeGameForm();
                          cancelRenameGameType();
                        }}
                        className={`min-w-0 flex-1 text-left text-sm transition ${
                          active ? "text-white" : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        {gameType}
                      </button>
                      <button
                        type="button"
                        onClick={() => openRenameGameType(gameType)}
                        className={`shrink-0 text-xs font-medium transition ${
                          active ? "text-gray-200 hover:text-white" : "text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        {t("编辑")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{activeGameType} {t("指令列表")}</h2>
              <p className="mt-1 text-sm text-gray-500">{t("维护当前游戏类型的指令模板、顺序和启用状态。")}</p>
            </div>
            <button
              type="button"
              onClick={openCreateForm}
              className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              {t("+ 新增指令")}
            </button>
          </div>

          {showForm ? (
            <div className="mt-5 rounded-3xl border border-gray-200 bg-gray-50 p-5">
              <p className="text-sm font-semibold text-gray-900">
                {editingItem ? `${t("编辑")}：${editingItem.label}` : t("新增指令")}
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">label</span>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">sort_order</span>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sort_order: Number(event.target.value) || 0,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                  />
                </label>
              </div>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-gray-700">content</span>
                <textarea
                  rows={5}
                  value={form.content}
                  onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                  className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? t("提交中...") : t("提交")}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                >
                  {t("取消")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
                {t("加载中…")}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
                {t("暂无指令")}
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {item.enabled ? t("启用") : t("禁用")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-500">{summarizeContent(item.content)}</p>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs text-gray-500">
                      sort_order: {item.sort_order}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(item)}
                      className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                    >
                      {t("编辑")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggle(item)}
                      className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                    >
                      {item.enabled ? t("禁用") : t("启用")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-300 hover:text-red-700"
                    >
                      {t("删除")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

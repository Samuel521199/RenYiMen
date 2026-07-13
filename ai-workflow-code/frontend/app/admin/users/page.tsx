"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import type { UserPermissions } from "@/lib/PermissionContext";
import type { User, UserRole } from "@/lib/types";

const USER_ROLES: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "管理员" },
  { value: "operator", label: "操作员" },
  { value: "reviewer", label: "审核员" },
  { value: "viewer", label: "查看者" },
];

interface UserFormState {
  username: string;
  password: string;
  role: UserRole;
}

interface ModelConfig {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  active: boolean;
}

interface PermissionRecord {
  user_id: number;
  model_config_id: number;
  model_name: string;
  username: string;
  created_at: string;
}

type UsersPayload =
  | User[]
  | {
      users?: User[];
      items?: User[];
      data?: User[];
    };

const emptyForm: UserFormState = {
  username: "",
  password: "",
  role: "operator",
};

const DELETE_PERMISSION_ITEMS = [
  { key: "assets", label: "素材库删除" },
  { key: "gallery", label: "成品图库删除" },
  { key: "video_gallery", label: "视频成品库删除" },
] as const;

const MODULE_PERMISSION_ITEMS = [
  { key: "dashboard", label: "首页看板" },
  { key: "assets", label: "素材库" },
  { key: "review", label: "审核中心" },
  { key: "gallery", label: "成品图库" },
  { key: "stats", label: "统计中心" },
  { key: "video_gallery", label: "视频成品库" },
] as const;

const WORKFLOW_PERMISSION_ITEMS = [
  { key: "expression", label: "表情制作" },
  { key: "activity", label: "活动图生产" },
  { key: "background", label: "背景图" },
  { key: "daily_post", label: "日常互动图" },
  { key: "share", label: "转发图" },
  { key: "trending", label: "热点借势" },
  { key: "trending_news", label: "热点新闻" },
  { key: "video", label: "视频制作" },
] as const;

const TEMPLATE_PERMISSION_ITEMS = [
  { key: "instructions", label: "指令库" },
  { key: "prompts", label: "Prompt模版" },
  { key: "activity_templates", label: "活动图模版" },
  { key: "daily_post_templates", label: "日常互动图模版" },
] as const;

const ADMIN_PERMISSION_ITEMS = [
  { key: "users", label: "用户管理" },
  { key: "api_keys", label: "API Keys" },
  { key: "logs", label: "审计日志" },
  { key: "models", label: "模型配置" },
  { key: "hotspot_import", label: "热点导入" },
  { key: "share_instructions", label: "分享指令" },
] as const;

function createEmptyPermissions(): UserPermissions {
  return {
    delete: {
      assets: false,
      gallery: false,
      video_gallery: false,
    },
    modules: {
      dashboard: false,
      assets: false,
      review: false,
      gallery: false,
      stats: false,
      video_gallery: false,
      tasks: {
        visible: false,
        workflows: Object.fromEntries(WORKFLOW_PERMISSION_ITEMS.map((item) => [item.key, false])),
      },
      templates: {
        visible: false,
        items: Object.fromEntries(TEMPLATE_PERMISSION_ITEMS.map((item) => [item.key, false])),
      },
      admin: {
        visible: false,
        items: Object.fromEntries(ADMIN_PERMISSION_ITEMS.map((item) => [item.key, false])),
      },
    },
  };
}

function clonePermissions(permissions: UserPermissions): UserPermissions {
  return JSON.parse(JSON.stringify(permissions)) as UserPermissions;
}

function roleLabel(role: UserRole) {
  switch (role) {
    case "admin":
      return "管理员";
    case "operator":
      return "操作员";
    case "reviewer":
      return "审核员";
    case "viewer":
      return "查看者";
    default:
      return role;
  }
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeUsers(payload: UsersPayload | undefined): User[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function isAdminUser(user: User) {
  return Boolean((user as User & { is_admin?: boolean }).is_admin || user.role === "admin");
}

export default function AdminUsersPage() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<User[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [permissionsByUser, setPermissionsByUser] = useState<Record<number, PermissionRecord[]>>({});
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [expandedAppPermissionUserId, setExpandedAppPermissionUserId] = useState<number | null>(null);
  const [appPermissionsByUser, setAppPermissionsByUser] = useState<Record<number, UserPermissions>>({});
  const [selectedModelByUser, setSelectedModelByUser] = useState<Record<number, string>>({});
  const [permissionLoadingUserId, setPermissionLoadingUserId] = useState<number | null>(null);
  const [appPermissionLoadingUserId, setAppPermissionLoadingUserId] = useState<number | null>(null);
  const [appPermissionSavingUserId, setAppPermissionSavingUserId] = useState<number | null>(null);
  const permissionSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ old_password: "", new_password: "" });
  const [changePasswordError, setChangePasswordError] = useState("");
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeUsers = Array.isArray(users) ? users : [];
  const safeModels = Array.isArray(models) ? models : [];
  const safeUserRoles = Array.isArray(USER_ROLES) ? USER_ROLES : [];

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<UsersPayload>("/api/users");
      if (res.code !== 0) {
        setError(res.msg || t("用户列表加载失败"));
        return;
      }
      setUsers(normalizeUsers(res.data));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setLoading(false);
    }
  }

  async function loadModels() {
    try {
      const res = await apiGet<ModelConfig[]>("/api/model-configs");
      if (res.code !== 0) {
        setError(res.msg || t("模型配置加载失败"));
        return;
      }
      setModels(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function loadPermissions(userId: number) {
    setPermissionLoadingUserId(userId);
    setError("");

    try {
      const res = await apiGet<PermissionRecord[]>(`/api/permissions/user/${userId}`);
      if (res.code !== 0) {
        setError(res.msg || t("模型权限加载失败"));
        return;
      }
      setPermissionsByUser((current) => ({
        ...current,
        [userId]: Array.isArray(res.data) ? res.data : [],
      }));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setPermissionLoadingUserId(null);
    }
  }

  async function loadAppPermissions(userId: number) {
    setAppPermissionLoadingUserId(userId);
    setError("");

    try {
      const res = await apiGet<UserPermissions>(`/api/users/${userId}/permissions`);
      if (res.code !== 0) {
        setError(res.msg || t("权限加载失败"));
        return;
      }
      setAppPermissionsByUser((current) => ({
        ...current,
        [userId]: res.data || createEmptyPermissions(),
      }));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setAppPermissionLoadingUserId(null);
    }
  }

  function queueSaveAppPermissions(userId: number, permissions: UserPermissions) {
    if (permissionSaveTimers.current[userId]) {
      clearTimeout(permissionSaveTimers.current[userId]);
    }
    permissionSaveTimers.current[userId] = setTimeout(async () => {
      setAppPermissionSavingUserId(userId);
      try {
        const res = await apiPut<UserPermissions>(`/api/users/${userId}/permissions`, {
          permissions,
        });
        if (res.code !== 0) {
          setError(res.msg || t("权限保存失败"));
          return;
        }
        setMessage(t("权限已保存"));
      } catch {
        setError(t("无法连接后端服务"));
      } finally {
        setAppPermissionSavingUserId(null);
      }
    }, 500);
  }

  function updateAppPermissions(
    userId: number,
    updater: (permissions: UserPermissions) => void,
  ) {
    const current = appPermissionsByUser[userId] || createEmptyPermissions();
    const next = clonePermissions(current);
    updater(next);
    setAppPermissionsByUser((existing) => ({ ...existing, [userId]: next }));
    queueSaveAppPermissions(userId, next);
  }

  async function toggleAppPermissionPanel(user: User) {
    if (isAdminUser(user)) return;
    const nextExpandedId = expandedAppPermissionUserId === user.id ? null : user.id;
    setExpandedAppPermissionUserId(nextExpandedId);
    if (nextExpandedId !== null && appPermissionsByUser[user.id] === undefined) {
      await loadAppPermissions(user.id);
    }
  }

  useEffect(() => {
    loadUsers();
    loadModels();
  }, []);

  useEffect(() => {
    const timers = permissionSaveTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await apiPost<User>("/api/users/create", {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
      });

      if (res.code !== 0) {
        setError(res.msg || t("创建用户失败"));
        return;
      }

      setForm(emptyForm);
      setShowCreate(false);
      await loadUsers();
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleUser(user: User) {
    setError("");

    try {
      const res = await apiPatch<User>(`/api/users/${user.id}`, {
        status: !user.status,
      });

      if (res.code !== 0) {
        setError(res.msg || t("更新用户状态失败"));
        return;
      }

      const updatedUser = res.data ?? user;
      setUsers((current) =>
        (Array.isArray(current) ? current : []).map((item) =>
          item.id === user.id ? { ...item, status: updatedUser.status } : item,
        ),
      );
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function togglePermissionPanel(user: User) {
    const nextExpandedId = expandedUserId === user.id ? null : user.id;
    setExpandedUserId(nextExpandedId);
    if (nextExpandedId !== null && permissionsByUser[user.id] === undefined) {
      await loadPermissions(user.id);
    }
  }

  async function grantModel(user: User) {
    const modelConfigId = Number(selectedModelByUser[user.id] || 0);
    if (!modelConfigId) {
      setError(t("请选择要授权的模型"));
      return;
    }

    setError("");
    try {
      const res = await apiPost<PermissionRecord>("/api/permissions/grant", {
        user_id: user.id,
        model_config_id: modelConfigId,
      });
      if (res.code !== 0) {
        setError(res.msg || t("授权失败"));
        return;
      }
      setSelectedModelByUser((current) => ({ ...current, [user.id]: "" }));
      await loadPermissions(user.id);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function revokeModel(user: User, modelConfigId: number) {
    setError("");
    try {
      const res = await apiDelete<{ revoked: number }>("/api/permissions/revoke", {
        user_id: user.id,
        model_config_id: modelConfigId,
      });
      if (res.code !== 0) {
        setError(res.msg || t("撤销授权失败"));
        return;
      }
      await loadPermissions(user.id);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function submitResetPassword() {
    if (!resetPasswordUser || !resetPasswordValue.trim()) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<{ success: boolean }>(
        `/api/users/${resetPasswordUser.id}/reset-password`,
        { new_password: resetPasswordValue },
      );
      if (res.code !== 0) {
        setError(res.msg || t("密码重置失败"));
        return;
      }
      setMessage(t("密码已重置"));
      setResetPasswordUser(null);
      setResetPasswordValue("");
      setShowResetPassword(false);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitChangePassword() {
    if (!changePasswordForm.old_password || !changePasswordForm.new_password) return;
    setSubmitting(true);
    setChangePasswordError("");
    setError("");
    setMessage("");
    try {
      const res = await apiPost<{ success: boolean }>("/api/users/me/change-password", changePasswordForm);
      if (res.code !== 0) {
        setChangePasswordError(res.msg || t("旧密码不正确"));
        return;
      }
      setMessage(t("密码已修改"));
      setShowChangePassword(false);
      setChangePasswordForm({ old_password: "", new_password: "" });
    } catch {
      setChangePasswordError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("用户管理")}
        description={t("管理后台账号和角色权限")}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setChangePasswordError("");
                setShowChangePassword(true);
              }}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {t("修改我的密码")}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              {t("新建用户")}
            </button>
          </div>
        }
      />

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

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="username">
                {t("用户名")}
              </label>
              <input
                id="username"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="password">
                {t("密码")}
              </label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="role">
                {t("角色")}
              </label>
              <select
                id="role"
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({ ...current, role: event.target.value as UserRole }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              >
                {safeUserRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {t(role.label)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setForm(emptyForm);
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {t("取消")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? t("创建中...") : t("创建用户")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("用户名")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("角色")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("状态")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("创建时间")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载用户...")}
                </td>
              </tr>
            ) : safeUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无用户")}
                </td>
              </tr>
            ) : (
              safeUsers.map((user) => {
                const permissions = Array.isArray(permissionsByUser[user.id])
                  ? permissionsByUser[user.id]
                  : [];
                const grantedModelIds = new Set(
                  permissions.map((permission) => permission.model_config_id),
                );
                const grantableModels = safeModels.filter(
                  (model) => !grantedModelIds.has(model.id),
                );
                const isExpanded = expandedUserId === user.id;
                const isAppPermissionExpanded = expandedAppPermissionUserId === user.id;
                const appPermissions = appPermissionsByUser[user.id] || createEmptyPermissions();
                const userIsAdmin = isAdminUser(user);

                return (
                  <Fragment key={user.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">#{user.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{user.username}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{t(roleLabel(user.role))}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            user.status
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {user.status ? t("启用") : t("禁用")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(user.created_at)}</td>
                      <td className="px-4 py-3 text-right text-sm">
                        <button
                          type="button"
                          onClick={() => togglePermissionPanel(user)}
                          className="font-medium text-gray-900 hover:text-gray-600"
                        >
                          {t("模型权限")}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAppPermissionPanel(user)}
                          disabled={userIsAdmin}
                          title={userIsAdmin ? t("管理员权限不可修改") : t("权限")}
                          className="ml-4 font-medium text-gray-900 hover:text-gray-600 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                          {t("权限")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetPasswordUser(user);
                            setResetPasswordValue("");
                            setShowResetPassword(false);
                          }}
                          className="ml-4 font-medium text-gray-900 hover:text-gray-600"
                        >
                          {t("重置密码")}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleUser(user)}
                          className="ml-4 font-medium text-gray-900 hover:text-gray-600"
                        >
                          {user.status ? t("禁用") : t("启用")}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-gray-50 px-4 py-4">
                          <div className="rounded-md border border-gray-200 bg-white p-4">
                            <div className="mb-4 flex items-start justify-between gap-4">
                              <div>
                                <h3 className="text-sm font-semibold text-gray-900">
                                  {user.username} {t("的模型权限")}
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                  {t("Admin 角色默认可使用全部启用模型；非 Admin 需要单独授权。")}
                                </p>
                              </div>
                            </div>

                            {!userIsAdmin && (
                              <div className="mb-4 flex flex-wrap gap-3">
                                <select
                                  value={selectedModelByUser[user.id] || ""}
                                  onChange={(event) =>
                                    setSelectedModelByUser((current) => ({
                                      ...current,
                                      [user.id]: event.target.value,
                                    }))
                                  }
                                  className="min-w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                                >
                                  <option value="">{t("选择模型")}</option>
                                  {grantableModels.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.name} / {model.model_name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => grantModel(user)}
                                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
                                >
                                  {t("授权")}
                                </button>
                              </div>
                            )}

                            {permissionLoadingUserId === user.id ? (
                              <div className="text-sm text-gray-500">{t("正在加载模型权限...")}</div>
                            ) : permissions.length === 0 ? (
                              <div className="text-sm text-gray-500">
                                {userIsAdmin
                                  ? t("默认拥有全部启用模型权限")
                                  : t("暂无授权模型")}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {permissions.map((permission) => (
                                  <span
                                    key={`${permission.user_id}-${permission.model_config_id}`}
                                    className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                                  >
                                    {permission.model_name}
                                    {!userIsAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => revokeModel(user, permission.model_config_id)}
                                        className="text-red-600 hover:text-red-700"
                                      >
                                        {t("撤销")}
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {isAppPermissionExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-gray-50 px-4 py-4">
                          <div className="rounded-md border border-gray-200 bg-white p-4">
                            <div className="mb-4 flex items-start justify-between gap-4">
                              <div>
                                <h3 className="text-sm font-semibold text-gray-900">
                                  {user.username} {t("的功能权限")}
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                  {appPermissionSavingUserId === user.id
                                    ? t("权限保存中...")
                                    : t("勾选后自动保存")}
                                </p>
                              </div>
                            </div>

                            {appPermissionLoadingUserId === user.id ? (
                              <div className="text-sm text-gray-500">{t("正在加载权限...")}</div>
                            ) : (
                              <div className="space-y-5 text-sm">
                                <div>
                                  <h4 className="mb-2 font-medium text-gray-900">{t("删除权限")}</h4>
                                  <div className="flex flex-wrap gap-4">
                                    {DELETE_PERMISSION_ITEMS.map((item) => (
                                      <label key={item.key} className="inline-flex items-center gap-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(appPermissions.delete[item.key])}
                                          onChange={(event) =>
                                            updateAppPermissions(user.id, (next) => {
                                              next.delete[item.key] = event.target.checked;
                                            })
                                          }
                                        />
                                        {t(item.label)}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <h4 className="mb-2 font-medium text-gray-900">{t("模块可见性")}</h4>
                                  <div className="flex flex-wrap gap-4">
                                    {MODULE_PERMISSION_ITEMS.map((item) => (
                                      <label key={item.key} className="inline-flex items-center gap-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(appPermissions.modules[item.key])}
                                          onChange={(event) =>
                                            updateAppPermissions(user.id, (next) => {
                                              next.modules[item.key] = event.target.checked;
                                            })
                                          }
                                        />
                                        {t(item.label)}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <div className="mb-2 flex items-center gap-3">
                                    <h4 className="font-medium text-gray-900">{t("任务中心")}</h4>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateAppPermissions(user.id, (next) => {
                                          const allChecked = WORKFLOW_PERMISSION_ITEMS.every(
                                            (item) => next.modules.tasks.workflows[item.key],
                                          );
                                          next.modules.tasks.visible = !allChecked;
                                          WORKFLOW_PERMISSION_ITEMS.forEach((item) => {
                                            next.modules.tasks.workflows[item.key] = !allChecked;
                                          });
                                        })
                                      }
                                      className="text-xs font-medium text-gray-600 hover:text-gray-900"
                                    >
                                      {t("全选/取消全选")}
                                    </button>
                                  </div>
                                  <label className="mb-2 inline-flex items-center gap-2 text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(appPermissions.modules.tasks.visible)}
                                      onChange={(event) =>
                                        updateAppPermissions(user.id, (next) => {
                                          next.modules.tasks.visible = event.target.checked;
                                          if (!event.target.checked) {
                                            WORKFLOW_PERMISSION_ITEMS.forEach((item) => {
                                              next.modules.tasks.workflows[item.key] = false;
                                            });
                                          }
                                        })
                                      }
                                    />
                                    {t("显示任务中心")}
                                  </label>
                                  <div className="flex flex-wrap gap-4">
                                    {WORKFLOW_PERMISSION_ITEMS.map((item) => (
                                      <label key={item.key} className="inline-flex items-center gap-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(appPermissions.modules.tasks.workflows[item.key])}
                                          onChange={(event) =>
                                            updateAppPermissions(user.id, (next) => {
                                              next.modules.tasks.workflows[item.key] = event.target.checked;
                                            })
                                          }
                                        />
                                        {t(item.label)}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <div className="mb-2 flex items-center gap-3">
                                    <h4 className="font-medium text-gray-900">{t("模版中心")}</h4>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateAppPermissions(user.id, (next) => {
                                          const allChecked = TEMPLATE_PERMISSION_ITEMS.every(
                                            (item) => next.modules.templates.items[item.key],
                                          );
                                          next.modules.templates.visible = !allChecked;
                                          TEMPLATE_PERMISSION_ITEMS.forEach((item) => {
                                            next.modules.templates.items[item.key] = !allChecked;
                                          });
                                        })
                                      }
                                      className="text-xs font-medium text-gray-600 hover:text-gray-900"
                                    >
                                      {t("全选/取消全选")}
                                    </button>
                                  </div>
                                  <label className="mb-2 inline-flex items-center gap-2 text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(appPermissions.modules.templates.visible)}
                                      onChange={(event) =>
                                        updateAppPermissions(user.id, (next) => {
                                          next.modules.templates.visible = event.target.checked;
                                          if (!event.target.checked) {
                                            TEMPLATE_PERMISSION_ITEMS.forEach((item) => {
                                              next.modules.templates.items[item.key] = false;
                                            });
                                          }
                                        })
                                      }
                                    />
                                    {t("显示模版中心")}
                                  </label>
                                  <div className="flex flex-wrap gap-4">
                                    {TEMPLATE_PERMISSION_ITEMS.map((item) => (
                                      <label key={item.key} className="inline-flex items-center gap-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(appPermissions.modules.templates.items[item.key])}
                                          onChange={(event) =>
                                            updateAppPermissions(user.id, (next) => {
                                              next.modules.templates.items[item.key] = event.target.checked;
                                            })
                                          }
                                        />
                                        {t(item.label)}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <div className="mb-2 flex items-center gap-3">
                                    <h4 className="font-medium text-gray-900">{t("管理后台")}</h4>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateAppPermissions(user.id, (next) => {
                                          const allChecked = ADMIN_PERMISSION_ITEMS.every(
                                            (item) => next.modules.admin.items[item.key],
                                          );
                                          next.modules.admin.visible = !allChecked;
                                          ADMIN_PERMISSION_ITEMS.forEach((item) => {
                                            next.modules.admin.items[item.key] = !allChecked;
                                          });
                                        })
                                      }
                                      className="text-xs font-medium text-gray-600 hover:text-gray-900"
                                    >
                                      {t("全选/取消全选")}
                                    </button>
                                  </div>
                                  <label className="mb-2 inline-flex items-center gap-2 text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(appPermissions.modules.admin.visible)}
                                      onChange={(event) =>
                                        updateAppPermissions(user.id, (next) => {
                                          next.modules.admin.visible = event.target.checked;
                                          if (!event.target.checked) {
                                            ADMIN_PERMISSION_ITEMS.forEach((item) => {
                                              next.modules.admin.items[item.key] = false;
                                            });
                                          }
                                        })
                                      }
                                    />
                                    {t("显示管理后台")}
                                  </label>
                                  <div className="flex flex-wrap gap-4">
                                    {ADMIN_PERMISSION_ITEMS.map((item) => (
                                      <label key={item.key} className="inline-flex items-center gap-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(appPermissions.modules.admin.items[item.key])}
                                          onChange={(event) =>
                                            updateAppPermissions(user.id, (next) => {
                                              next.modules.admin.items[item.key] = event.target.checked;
                                            })
                                          }
                                        />
                                        {t(item.label)}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {resetPasswordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">{t("重置密码")}</h3>
            <p className="mt-1 text-sm text-gray-500">
              {resetPasswordUser.username} {t("的新密码")}
            </p>
            <div className="mt-4 flex gap-2">
              <input
                type={showResetPassword ? "text" : "password"}
                value={resetPasswordValue}
                onChange={(event) => setResetPasswordValue(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
              <button
                type="button"
                onClick={() => setShowResetPassword((value) => !value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {showResetPassword ? t("隐藏") : t("显示")}
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setResetPasswordUser(null);
                  setResetPasswordValue("");
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                onClick={submitResetPassword}
                disabled={submitting || !resetPasswordValue.trim()}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {t("确认")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">{t("修改我的密码")}</h3>
            <div className="mt-4 space-y-3">
              <input
                type="password"
                value={changePasswordForm.old_password}
                onChange={(event) =>
                  setChangePasswordForm((current) => ({
                    ...current,
                    old_password: event.target.value,
                  }))
                }
                placeholder={t("旧密码")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
              <input
                type="password"
                value={changePasswordForm.new_password}
                onChange={(event) =>
                  setChangePasswordForm((current) => ({
                    ...current,
                    new_password: event.target.value,
                  }))
                }
                placeholder={t("新密码")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
              {changePasswordError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {changePasswordError}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowChangePassword(false);
                  setChangePasswordError("");
                  setChangePasswordForm({ old_password: "", new_password: "" });
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                onClick={submitChangePassword}
                disabled={submitting || !changePasswordForm.old_password || !changePasswordForm.new_password}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {t("确认")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

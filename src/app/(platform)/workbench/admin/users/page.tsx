// @ts-nocheck
"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@workbench/lib/api";
import { getToken } from "@workbench/lib/auth";
import { useLanguage } from "@workbench/lib/LanguageContext";
import type { UserPermissions } from "@workbench/lib/PermissionContext";
import type { User, UserRole } from "@workbench/lib/types";

const USER_ROLES: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "管理员" },
  { value: "operator", label: "操作员" },
  { value: "reviewer", label: "审核员" },
  { value: "viewer", label: "查看者" },
];

interface UserFormState {
  email: string;
  name: string;
  password: string;
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
  daily_token_limit?: number;
  daily_cost_limit?: string;
  daily_image_limit?: number;
  used_today_tokens?: number;
  used_today_cost?: string;
  used_today_images?: number;
}

interface QuotaDraft {
  daily_token_limit: string;
  daily_cost_limit: string;
}

interface PermissionQuotaDraft extends QuotaDraft {
  daily_image_limit: string;
}

type UsersPayload =
  | User[]
  | {
      users?: User[];
      items?: User[];
      data?: User[];
    };

const emptyForm: UserFormState = {
  email: "",
  name: "",
  password: "",
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
  { key: "multi_fusion", label: "多图融合" },
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

function emptyPermissionQuotaDraft(): PermissionQuotaDraft {
  return { daily_token_limit: "0", daily_cost_limit: "0", daily_image_limit: "0" };
}

function emptyQuotaDraft(): QuotaDraft {
  return { daily_token_limit: "0", daily_cost_limit: "0" };
}

function permissionDraftKey(userId: number, modelConfigId: number) {
  return `${userId}-${modelConfigId}`;
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
  const [grantLimitsByUser, setGrantLimitsByUser] = useState<Record<number, PermissionQuotaDraft>>({});
  const [userQuotaDraftByUser, setUserQuotaDraftByUser] = useState<Record<number, QuotaDraft>>({});
  const [permissionQuotaDraft, setPermissionQuotaDraft] = useState<Record<string, PermissionQuotaDraft>>({});
  const [quotaSavingUserId, setQuotaSavingUserId] = useState<number | null>(null);
  const [permissionQuotaSavingKey, setPermissionQuotaSavingKey] = useState<string | null>(null);
  const [permissionLoadingUserId, setPermissionLoadingUserId] = useState<number | null>(null);
  const [appPermissionLoadingUserId, setAppPermissionLoadingUserId] = useState<number | null>(null);
  const [appPermissionSavingUserId, setAppPermissionSavingUserId] = useState<number | null>(null);
  const permissionSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordEmail, setResetPasswordEmail] = useState("");
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
      const nextQuotaDraft: Record<number, QuotaDraft> = {};
      normalizeUsers(res.data).forEach((user) => {
        nextQuotaDraft[user.id] = {
          daily_token_limit: String(user.daily_token_limit ?? 0),
          daily_cost_limit: String(user.daily_cost_limit ?? "0"),
        };
      });
      setUserQuotaDraftByUser(nextQuotaDraft);
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
      const nextDraft: Record<string, PermissionQuotaDraft> = {};
      (Array.isArray(res.data) ? res.data : []).forEach((permission) => {
        nextDraft[permissionDraftKey(permission.user_id, permission.model_config_id)] = {
          daily_token_limit: String(permission.daily_token_limit ?? 0),
          daily_cost_limit: String(permission.daily_cost_limit ?? "0"),
          daily_image_limit: String(permission.daily_image_limit ?? 0),
        };
      });
      setPermissionQuotaDraft((current) => ({ ...current, ...nextDraft }));
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

    const email = form.email.trim();
    if (!email) { setError(t("请输入邮箱")); setSubmitting(false); return; }
    if (form.password.length < 8) { setError(t("密码至少 8 位")); setSubmitting(false); return; }

    try {
      // 通过主平台 API 创建，确保用户可用邮箱登录前台
      // 同时携带 workbench JWT，供 API 验证工作台管理员身份
      const wbToken = getToken();
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(wbToken ? { Authorization: `Bearer ${wbToken}` } : {}),
        },
        body: JSON.stringify({ email, name: form.name.trim() || undefined, password: form.password }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || json?.ok !== true) {
        setError(typeof json?.error === "string" ? json.error : t("创建用户失败"));
        return;
      }

      const createdEmail = email;
      setForm(emptyForm);
      setShowCreate(false);
      setMessage(
        `用户创建成功！邮箱：${createdEmail}。` +
        `用户可用该邮箱 + 密码登录前台，首次进入工作台后会自动同步到此列表，` +
        `之后在"权限"列配置工作台访问权限即可。`,
      );
      // 主平台账号已创建，工作台侧要等用户首次 SSO 后才会出现，列表此时不会立刻更新
      await loadUsers();
    } catch {
      setError(t("无法连接服务，请稍后重试"));
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

    const grantLimits = grantLimitsByUser[user.id] || emptyPermissionQuotaDraft();
    setError("");
    try {
      const res = await apiPost<PermissionRecord>("/api/permissions/grant", {
        user_id: user.id,
        model_config_id: modelConfigId,
        daily_token_limit: Number(grantLimits.daily_token_limit || 0),
        daily_cost_limit: grantLimits.daily_cost_limit || "0",
        daily_image_limit: Number(grantLimits.daily_image_limit || 0),
      });
      if (res.code !== 0) {
        setError(res.msg || t("授权失败"));
        return;
      }
      setSelectedModelByUser((current) => ({ ...current, [user.id]: "" }));
      setGrantLimitsByUser((current) => ({ ...current, [user.id]: emptyPermissionQuotaDraft() }));
      await loadPermissions(user.id);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function saveUserQuota(user: User) {
    const draft = userQuotaDraftByUser[user.id] || emptyQuotaDraft();
    setQuotaSavingUserId(user.id);
    setError("");
    try {
      const res = await apiPatch(`/api/users/${user.id}/quota`, {
        daily_token_limit: Number(draft.daily_token_limit || 0),
        daily_cost_limit: draft.daily_cost_limit || "0",
      });
      if (res.code !== 0) {
        setError(res.msg || t("配额保存失败"));
        return;
      }
      setMessage(t("配额已保存"));
      await loadUsers();
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setQuotaSavingUserId(null);
    }
  }

  async function savePermissionQuota(user: User, permission: PermissionRecord) {
    const key = permissionDraftKey(permission.user_id, permission.model_config_id);
    const draft = permissionQuotaDraft[key] || emptyPermissionQuotaDraft();
    setPermissionQuotaSavingKey(key);
    setError("");
    try {
      const res = await apiPut<PermissionRecord>("/api/permissions/limits", {
        user_id: permission.user_id,
        model_config_id: permission.model_config_id,
        daily_token_limit: Number(draft.daily_token_limit || 0),
        daily_cost_limit: draft.daily_cost_limit || "0",
        daily_image_limit: Number(draft.daily_image_limit || 0),
      });
      if (res.code !== 0) {
        setError(res.msg || t("配额保存失败"));
        return;
      }
      setMessage(t("配额已保存"));
      await loadPermissions(user.id);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setPermissionQuotaSavingKey(null);
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
    if (!resetPasswordUser || !resetPasswordValue.trim() || !resetPasswordEmail.trim()) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      // 重置主平台登录密码（按邮箱查找），而非 Workbench 内部密码
      const wbToken = getToken();
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(wbToken ? { Authorization: `Bearer ${wbToken}` } : {}),
        },
        body: JSON.stringify({
          email: resetPasswordEmail.trim().toLowerCase(),
          new_password: resetPasswordValue,
        }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || json?.ok !== true) {
        setError(typeof json?.error === "string" ? json.error : t("密码重置失败"));
        return;
      }
      setMessage(`${resetPasswordUser.username} 的登录密码已重置`);
      setResetPasswordUser(null);
      setResetPasswordValue("");
      setResetPasswordEmail("");
      setShowResetPassword(false);
    } catch {
      setError(t("无法连接服务，请稍后重试"));
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
      // 改主平台密码（NextAuth 登录密码），而非 Workbench 内部随机密码
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_password: changePasswordForm.old_password,
          new_password: changePasswordForm.new_password,
        }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || json?.ok !== true) {
        setChangePasswordError(typeof json?.error === "string" ? json.error : t("旧密码不正确"));
        return;
      }
      setMessage(t("密码已修改"));
      setShowChangePassword(false);
      setChangePasswordForm({ old_password: "", new_password: "" });
    } catch {
      setChangePasswordError(t("无法连接服务，请稍后重试"));
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
          <p className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            创建后用户可用 <strong>邮箱 + 密码</strong> 登录前台，首次进入工作台时账号将自动同步，再由此页面配置权限。
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="create-email">
                {t("邮箱")} <span className="text-red-500">*</span>
              </label>
              <input
                id="create-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="create-name">
                {t("昵称")}（可选）
              </label>
              <input
                id="create-name"
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                placeholder={t("用户昵称")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="create-password">
                {t("密码")} <span className="text-red-500">*</span>
              </label>
              <input
                id="create-password"
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                placeholder={t("至少 8 位")}
                required
              />
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("工作台权限")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("创建时间")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载用户...")}
                </td>
              </tr>
            ) : safeUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
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
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            user.status
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                              : "border-slate-600/40 bg-slate-700/40 text-slate-400"
                          }`}
                        >
                          {user.status ? t("启用") : t("禁用")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {userIsAdmin ? (
                          <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-300">
                            {t("管理员")}
                          </span>
                        ) : user.permissions_granted ? (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                            {t("已授权")}
                          </span>
                        ) : (
                          <span
                            className="cursor-pointer rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25"
                            title={t('点击「权限」列展开授权面板')}
                            onClick={() => toggleAppPermissionPanel(user)}
                          >
                            {t("待授权 ↗")}
                          </span>
                        )}
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
                            setResetPasswordEmail("");
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
                        <td colSpan={7} className="bg-gray-50 px-4 py-4">
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
                              <div className="mb-6 rounded-md border border-gray-100 bg-gray-50 p-4">
                                <h4 className="text-sm font-medium text-gray-900">{t("用户级配额")}</h4>
                                <p className="mt-1 text-xs text-gray-500">{t("0 表示不限制")}</p>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                  <label className="block text-xs text-gray-600">
                                    {t("每日 Token 上限")}
                                    <input
                                      type="number"
                                      min="0"
                                      value={userQuotaDraftByUser[user.id]?.daily_token_limit ?? "0"}
                                      onChange={(event) =>
                                        setUserQuotaDraftByUser((current) => ({
                                          ...current,
                                          [user.id]: {
                                            ...(current[user.id] || emptyQuotaDraft()),
                                            daily_token_limit: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    />
                                  </label>
                                  <label className="block text-xs text-gray-600">
                                    {t("每日费用上限 (USD)")}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={userQuotaDraftByUser[user.id]?.daily_cost_limit ?? "0"}
                                      onChange={(event) =>
                                        setUserQuotaDraftByUser((current) => ({
                                          ...current,
                                          [user.id]: {
                                            ...(current[user.id] || emptyQuotaDraft()),
                                            daily_cost_limit: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    />
                                  </label>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                                  <span>
                                    {t("今日已用 Token")}: {user.used_today_tokens ?? 0}
                                  </span>
                                  <span>
                                    {t("今日已用费用")}: ${user.used_today_cost ?? "0"}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => saveUserQuota(user)}
                                  disabled={quotaSavingUserId === user.id}
                                  className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                                >
                                  {quotaSavingUserId === user.id ? t("权限保存中...") : t("保存配额")}
                                </button>
                              </div>
                            )}

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
                                <input
                                  type="number"
                                  min="0"
                                  placeholder={t("每日 Token 上限")}
                                  value={grantLimitsByUser[user.id]?.daily_token_limit ?? "0"}
                                  onChange={(event) =>
                                    setGrantLimitsByUser((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...(current[user.id] || emptyPermissionQuotaDraft()),
                                        daily_token_limit: event.target.value,
                                      },
                                    }))
                                  }
                                  className="w-36 rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.0001"
                                  placeholder={t("每日费用上限 (USD)")}
                                  value={grantLimitsByUser[user.id]?.daily_cost_limit ?? "0"}
                                  onChange={(event) =>
                                    setGrantLimitsByUser((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...(current[user.id] || emptyPermissionQuotaDraft()),
                                        daily_cost_limit: event.target.value,
                                      },
                                    }))
                                  }
                                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  placeholder={t("每日出图上限")}
                                  value={grantLimitsByUser[user.id]?.daily_image_limit ?? "0"}
                                  onChange={(event) =>
                                    setGrantLimitsByUser((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...(current[user.id] || emptyPermissionQuotaDraft()),
                                        daily_image_limit: event.target.value,
                                      },
                                    }))
                                  }
                                  className="w-36 rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
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
                              <div className="space-y-4">
                                {!userIsAdmin && (
                                  <h4 className="text-sm font-medium text-gray-900">{t("模型级配额")}</h4>
                                )}
                                {permissions.map((permission) => {
                                  const draftKey = permissionDraftKey(
                                    permission.user_id,
                                    permission.model_config_id,
                                  );
                                  const draft = permissionQuotaDraft[draftKey] || emptyPermissionQuotaDraft();
                                  return (
                                    <div
                                      key={draftKey}
                                      className="rounded-md border border-gray-200 p-4"
                                    >
                                      <div className="mb-3 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium text-gray-900">
                                          {permission.model_name}
                                        </span>
                                        {!userIsAdmin && (
                                          <button
                                            type="button"
                                            onClick={() => revokeModel(user, permission.model_config_id)}
                                            className="text-xs font-medium text-red-600 hover:text-red-700"
                                          >
                                            {t("撤销")}
                                          </button>
                                        )}
                                      </div>
                                      {!userIsAdmin ? (
                                        <>
                                          <div className="grid gap-3 md:grid-cols-3">
                                            <label className="block text-xs text-gray-600">
                                              {t("每日 Token 上限")}
                                              <input
                                                type="number"
                                                min="0"
                                                value={draft.daily_token_limit}
                                                onChange={(event) =>
                                                  setPermissionQuotaDraft((current) => ({
                                                    ...current,
                                                    [draftKey]: {
                                                      ...draft,
                                                      daily_token_limit: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                              />
                                            </label>
                                            <label className="block text-xs text-gray-600">
                                              {t("每日费用上限 (USD)")}
                                              <input
                                                type="number"
                                                min="0"
                                                step="0.0001"
                                                value={draft.daily_cost_limit}
                                                onChange={(event) =>
                                                  setPermissionQuotaDraft((current) => ({
                                                    ...current,
                                                    [draftKey]: {
                                                      ...draft,
                                                      daily_cost_limit: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                              />
                                            </label>
                                            <label className="block text-xs text-gray-600">
                                              {t("每日出图上限")}
                                              <input
                                                type="number"
                                                min="0"
                                                value={draft.daily_image_limit}
                                                onChange={(event) =>
                                                  setPermissionQuotaDraft((current) => ({
                                                    ...current,
                                                    [draftKey]: {
                                                      ...draft,
                                                      daily_image_limit: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                              />
                                            </label>
                                          </div>
                                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                                            <span>
                                              {t("今日已用 Token")}: {permission.used_today_tokens ?? 0}
                                            </span>
                                            <span>
                                              {t("今日已用费用")}: ${permission.used_today_cost ?? "0"}
                                            </span>
                                            <span>
                                              {t("今日已出图")}: {permission.used_today_images ?? 0}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => savePermissionQuota(user, permission)}
                                            disabled={permissionQuotaSavingKey === draftKey}
                                            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                                          >
                                            {permissionQuotaSavingKey === draftKey
                                              ? t("权限保存中...")
                                              : t("保存模型配额")}
                                          </button>
                                        </>
                                      ) : (
                                        <span className="text-xs text-gray-500">{permission.model_name}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {isAppPermissionExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-4 py-4">
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
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAppPermissions(user.id, (next) => {
                                      // 删除权限全开
                                      next.delete.assets = true;
                                      next.delete.gallery = true;
                                      next.delete.video_gallery = true;
                                      // 模块全开
                                      next.modules.dashboard = true;
                                      next.modules.assets = true;
                                      next.modules.review = true;
                                      next.modules.gallery = true;
                                      next.modules.stats = true;
                                      next.modules.video_gallery = true;
                                      // 任务中心全开
                                      next.modules.tasks.visible = true;
                                      WORKFLOW_PERMISSION_ITEMS.forEach((item) => {
                                        next.modules.tasks.workflows[item.key] = true;
                                      });
                                      // 模版中心全开
                                      next.modules.templates.visible = true;
                                      TEMPLATE_PERMISSION_ITEMS.forEach((item) => {
                                        next.modules.templates.items[item.key] = true;
                                      });
                                      // 管理后台由 role=admin 控制，不在此处授权
                                    })
                                  }
                                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                                >
                                  {t("全部授权")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAppPermissions(user.id, (next) => {
                                      next.delete.assets = false;
                                      next.delete.gallery = false;
                                      next.delete.video_gallery = false;
                                      next.modules.dashboard = false;
                                      next.modules.assets = false;
                                      next.modules.review = false;
                                      next.modules.gallery = false;
                                      next.modules.stats = false;
                                      next.modules.video_gallery = false;
                                      next.modules.tasks.visible = false;
                                      WORKFLOW_PERMISSION_ITEMS.forEach((item) => {
                                        next.modules.tasks.workflows[item.key] = false;
                                      });
                                      next.modules.templates.visible = false;
                                      TEMPLATE_PERMISSION_ITEMS.forEach((item) => {
                                        next.modules.templates.items[item.key] = false;
                                      });
                                    })
                                  }
                                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                                >
                                  {t("全部撤销")}
                                </button>
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

                                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                                  管理后台（用户管理、模型配置等）仅限 <strong>role=admin</strong> 的账号访问，无法通过此处授权给普通用户。如需给某用户开放管理权限，请联系超级管理员将其角色改为 admin。
                                </p>
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
            <h3 className="text-base font-semibold text-gray-900">{t("重置登录密码")}</h3>
            <p className="mt-1 text-sm text-gray-500">
              工作台账号：<strong>{resetPasswordUser.username}</strong>
            </p>
            <p className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              需要填写该用户的<strong>主平台登录邮箱</strong>，密码将同步更新，用户下次用新密码登录前台即可生效。
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">{t("用户登录邮箱")} <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={resetPasswordEmail}
                  onChange={(event) => setResetPasswordEmail(event.target.value)}
                  placeholder="user@example.com"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">{t("新密码")} <span className="text-red-500">*</span></label>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showResetPassword ? "text" : "password"}
                    value={resetPasswordValue}
                    onChange={(event) => setResetPasswordValue(event.target.value)}
                    placeholder={t("至少 8 位")}
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
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setResetPasswordUser(null);
                  setResetPasswordValue("");
                  setResetPasswordEmail("");
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                onClick={submitResetPassword}
                disabled={submitting || !resetPasswordValue.trim() || !resetPasswordEmail.trim()}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {submitting ? t("重置中...") : t("确认重置")}
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

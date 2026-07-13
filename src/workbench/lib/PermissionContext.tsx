"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "@workbench/lib/api";
import { getToken, onAuthTokenChange } from "@workbench/lib/auth";

export interface UserPermissions {
  delete: {
    assets: boolean;
    gallery: boolean;
    video_gallery: boolean;
  };
  modules: {
    dashboard: boolean;
    assets: boolean;
    review: boolean;
    gallery: boolean;
    stats: boolean;
    video_gallery: boolean;
    tasks: {
      visible: boolean;
      workflows: Record<string, boolean>;
    };
    templates: {
      visible: boolean;
      items: Record<string, boolean>;
    };
    admin: {
      visible: boolean;
      items: Record<string, boolean>;
    };
  };
}

type DeleteTarget = "assets" | "gallery" | "video_gallery";

type PermissionContextValue = {
  permissions: UserPermissions | null;
  isAdmin: boolean;
  canDelete: (target: DeleteTarget) => boolean;
  canView: (moduleKey: string) => boolean;
  canViewWorkflow: (workflowKey: string) => boolean;
  canViewTemplate: (itemKey: string) => boolean;
  canViewAdmin: (itemKey: string) => boolean;
  loadPermissions: () => Promise<void>;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

type UserWithPermissions = {
  id?: number | string;
  username?: string;
  role?: string;
  is_admin?: boolean;
  permissions?: UserPermissions | null;
};

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  /**
   * 请求序号：每次发起新请求时自增。
   * 响应回来时对比序号，若不是最新请求则丢弃结果，
   * 彻底解决「切换账号时旧请求覆盖新结果」的竞态问题。
   */
  const reqSeqRef = useRef(0);

  const loadPermissions = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setPermissions(null);
      setIsAdmin(false);
      return;
    }

    // 自增序号，标记本次请求
    const seq = ++reqSeqRef.current;

    // 立即清空旧权限：避免旧账号的权限在新请求完成前被守卫误判。
    // 清空后守卫显示「正在验证权限…」占位，而非错误的「无权限」。
    setPermissions(null);
    setIsAdmin(false);

    try {
      const res = await apiGet<UserWithPermissions>("/api/users/me");
      // 丢弃过时响应（已有更新的请求在途中）
      if (seq !== reqSeqRef.current) return;

      if (res.code !== 0 || !res.data) {
        setPermissions(null);
        setIsAdmin(false);
        return;
      }
      const user = res.data;
      setIsAdmin(Boolean(user?.is_admin || user?.role === "admin"));
      setPermissions((user?.permissions ?? null) as UserPermissions | null);
    } catch {
      if (seq !== reqSeqRef.current) return;
      setPermissions(null);
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    void loadPermissions();
    return onAuthTokenChange(() => {
      void loadPermissions();
    });
  }, [loadPermissions]);

  const value = useMemo<PermissionContextValue>(
    () => ({
      permissions,
      isAdmin,
      canDelete: (target) => {
        if (isAdmin) return true;
        if (!permissions) return false;
        return Boolean(permissions.delete?.[target]);
      },
      canView: (moduleKey) => {
        if (isAdmin) return true;
        if (!permissions) return false;
        // 管理后台由 role=admin 控制，permissions.modules.admin 不再作为普通用户的开关
        if (moduleKey === "admin") return false;
        if (moduleKey === "tasks") return Boolean(permissions.modules?.tasks?.visible);
        if (moduleKey === "templates") return Boolean(permissions.modules?.templates?.visible);
        return Boolean(permissions.modules?.[moduleKey as keyof UserPermissions["modules"]]);
      },
      canViewWorkflow: (workflowKey) => {
        if (isAdmin) return true;
        if (!permissions) return false;
        return Boolean(permissions.modules?.tasks?.workflows?.[workflowKey]);
      },
      canViewTemplate: (itemKey) => {
        if (isAdmin) return true;
        if (!permissions) return false;
        return Boolean(permissions.modules?.templates?.items?.[itemKey]);
      },
      canViewAdmin: (itemKey) => {
        // 管理后台仅限 role=admin 角色，permissions 字段不再决定此项
        if (isAdmin) return true;
        return false;
      },
      loadPermissions,
    }),
    [isAdmin, loadPermissions, permissions],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermission() {
  const value = useContext(PermissionContext);
  if (!value) {
    return {
      permissions: null,
      isAdmin: false,
      canDelete: () => false,
      canView: () => false,
      canViewWorkflow: () => false,
      canViewTemplate: () => false,
      canViewAdmin: () => false,
      loadPermissions: async () => undefined,
    } satisfies PermissionContextValue;
  }
  return value;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { getToken, onAuthTokenChange } from "@/lib/auth";

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

  const loadPermissions = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setPermissions(null);
      setIsAdmin(false);
      return;
    }

    try {
      const res = await apiGet<UserWithPermissions>("/api/users/me");
      if (res.code !== 0 || !res.data) {
        setPermissions(null);
        setIsAdmin(false);
        return;
      }
      const user = res.data;
      setIsAdmin(Boolean(user?.is_admin || user?.role === "admin"));
      setPermissions((user?.permissions ?? null) as UserPermissions | null);
    } catch {
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
        if (moduleKey === "tasks") return Boolean(permissions.modules?.tasks?.visible);
        if (moduleKey === "templates") return Boolean(permissions.modules?.templates?.visible);
        if (moduleKey === "admin") return Boolean(permissions.modules?.admin?.visible);
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
        if (isAdmin) return true;
        if (!permissions) return false;
        return Boolean(permissions.modules?.admin?.items?.[itemKey]);
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

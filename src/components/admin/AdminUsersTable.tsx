"use client";

import { useCallback, useState } from "react";
import { Gem, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  balance: number;
  /** 历史 CONSUME 流水合计（积分，按绝对值汇总） */
  totalConsumed: number;
};

function formatCredits(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring";

export function AdminUsersTable({ initialUsers }: { initialUsers: AdminUserRow[] }) {
  const [users, setUsers] = useState(initialUsers);

  // --- 充值 dialog ---
  const [dialogUser, setDialogUser] = useState<AdminUserRow | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- 新建用户 dialog ---
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialogUser(null);
    setAmountStr("");
    setError(null);
    setSubmitting(false);
  }, []);

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setCreateEmail("");
    setCreateName("");
    setCreatePassword("");
    setCreateError(null);
    setCreating(false);
  }, []);

  const submitCreate = useCallback(async () => {
    setCreateError(null);
    if (!createEmail.trim()) { setCreateError("请输入邮箱"); return; }
    if (createPassword.length < 8) { setCreateError("密码至少 8 位"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: createEmail.trim(), name: createName.trim(), password: createPassword }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || json?.ok !== true) {
        setCreateError(typeof json?.error === "string" ? json.error : `请求失败（${res.status}）`);
        return;
      }
      const newUser = json.user as AdminUserRow;
      setUsers((prev) => [{ ...newUser, totalConsumed: 0 }, ...prev]);
      closeCreate();
    } catch {
      setCreateError("网络异常，请重试");
    } finally {
      setCreating(false);
    }
  }, [createEmail, createName, createPassword, closeCreate]);

  const submitRecharge = useCallback(async () => {
    if (!dialogUser) return;
    const n = Math.floor(Number(amountStr.trim()));
    if (!Number.isFinite(n) || n <= 0) {
      setError("请输入正整数积分");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/recharge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ targetUserId: dialogUser.id, amount: n }),
      });
      const json: unknown = await res.json().catch(() => null);
      const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!res.ok || !rec || rec.ok !== true) {
        const msg = rec && typeof rec.error === "string" ? rec.error : `请求失败（${res.status}）`;
        setError(msg);
        return;
      }
      const after =
        rec && typeof rec.balanceAfter === "number" && Number.isFinite(rec.balanceAfter)
          ? Math.floor(rec.balanceAfter)
          : null;
      setUsers((prev) =>
        prev.map((u) =>
          u.id === dialogUser.id ? { ...u, balance: after != null ? after : u.balance + n } : u
        )
      );
      closeDialog();
    } catch {
      setError("网络异常");
    } finally {
      setSubmitting(false);
    }
  }, [amountStr, closeDialog, dialogUser]);

  return (
    <>
      {/* 新建用户按钮 */}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
          <UserPlus className="mr-1.5 size-4" />
          新建用户
        </Button>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">用户名</TableHead>
              <TableHead className="text-xs">邮箱</TableHead>
              <TableHead className="w-[140px] text-right text-xs">当前积分</TableHead>
              <TableHead className="w-[140px] text-right text-xs">累计消耗</TableHead>
              <TableHead className="w-[100px] text-right text-xs">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className="text-sm">
                <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                <TableCell className="max-w-[240px] truncate font-mono text-xs text-muted-foreground">
                  {u.email ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Gem className="size-3.5 text-amber-500/90" aria-hidden />
                    {formatCredits(u.balance)}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatCredits(u.totalConsumed)}
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => setDialogUser(u)}>
                    充值
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 新建用户 dialog */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeCreate}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">新建用户</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              创建后用户可用邮箱 + 密码登录，默认积分 0，工作台功能需管理员授权。
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                邮箱 <span className="text-destructive">*</span>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="user@example.com"
                />
              </label>
              <label className="block text-sm font-medium">
                昵称（可选）
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="用户昵称"
                />
              </label>
              <label className="block text-sm font-medium">
                初始密码 <span className="text-destructive">*</span>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="至少 8 位"
                />
              </label>
            </div>
            {createError && <p className="mt-3 text-sm text-destructive">{createError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeCreate} disabled={creating}>
                取消
              </Button>
              <Button type="button" onClick={() => void submitCreate()} disabled={creating}>
                {creating ? "创建中…" : "创建用户"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialogUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeDialog}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">为用户充值</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              目标：<span className="font-medium text-foreground">{dialogUser.name ?? dialogUser.email ?? dialogUser.id}</span>
            </p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{dialogUser.id}</p>
            <label className="mt-4 block text-sm font-medium">
              充值积分
              <input
                type="number"
                min={1}
                step={1}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="例如 500"
              />
            </label>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                取消
              </Button>
              <Button type="button" onClick={() => void submitRecharge()} disabled={submitting}>
                {submitting ? "提交中…" : "确认充值"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

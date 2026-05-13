"use client";

export function AdminMgmtLogoutButton() {
  return (
    <form action="/api/admin/panel/logout" method="post">
      <button
        type="submit"
        className="font-medium text-foreground/90 underline-offset-4 hover:underline"
      >
        退出管理端
      </button>
    </form>
  );
}

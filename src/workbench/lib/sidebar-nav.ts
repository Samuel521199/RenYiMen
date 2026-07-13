const SIDEBAR_CHILD_BASE_CLASSES =
  "flex items-center rounded-lg px-3 py-2 text-sm transition-colors";

export function isSidebarItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getSidebarChildLinkClasses(isActive: boolean): string {
  return `${SIDEBAR_CHILD_BASE_CLASSES} ${
    isActive
      ? "bg-indigo-500/10 text-indigo-200"
      : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
  }`;
}

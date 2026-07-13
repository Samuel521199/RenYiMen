const SIDEBAR_CHILD_BASE_CLASSES =
  "flex items-center rounded-lg px-3 py-2 text-sm transition-colors";

export function isSidebarItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getSidebarChildLinkClasses(isActive: boolean): string {
  return `${SIDEBAR_CHILD_BASE_CLASSES} ${
    isActive
      ? "text-gray-900 hover:bg-gray-100"
      : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
  }`;
}

import type { ReactNode } from "react";

import {
  WB_PAGE_DESC_CLASS,
  WB_PAGE_TITLE_CLASS,
} from "@workbench/lib/workbench-ui-theme";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  prominent?: boolean;
}

export default function PageHeader({ title, description, action, prominent = false }: PageHeaderProps) {
  return (
    <div className={`workbench-page-header ${prominent ? "mb-9" : "mb-6"} flex items-start justify-between gap-4`}>
      <div>
        <h1 className={`workbench-page-title ${prominent ? "text-[clamp(2rem,2.35vw,2.65rem)] font-semibold leading-none tracking-[-0.045em] text-[#eef4f7]" : WB_PAGE_TITLE_CLASS}`}>{title}</h1>
        {description && <p className={`workbench-page-description ${prominent ? "mt-3 max-w-3xl text-[15px] leading-6 text-white/52" : WB_PAGE_DESC_CLASS}`}>{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

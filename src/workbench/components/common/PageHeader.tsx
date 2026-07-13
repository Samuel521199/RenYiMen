import type { ReactNode } from "react";

import {
  WB_PAGE_DESC_CLASS,
  WB_PAGE_TITLE_CLASS,
} from "@workbench/lib/workbench-ui-theme";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className={WB_PAGE_TITLE_CLASS}>{title}</h1>
        {description && <p className={WB_PAGE_DESC_CLASS}>{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

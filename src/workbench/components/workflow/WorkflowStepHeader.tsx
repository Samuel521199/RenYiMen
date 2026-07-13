"use client";

import type React from "react";

import { WB_PAGE_DESC_CLASS, WB_SECTION_TITLE_CLASS } from "@workbench/lib/workbench-ui-theme";

interface WorkflowStepHeaderProps {
  step: number;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export default function WorkflowStepHeader({
  step,
  title,
  description,
  actions,
}: WorkflowStepHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className={`text-lg ${WB_SECTION_TITLE_CLASS}`}>
          Step {step} — {title}
        </h2>
        {description && <p className={WB_PAGE_DESC_CLASS}>{description}</p>}
      </div>
      {actions}
    </div>
  );
}

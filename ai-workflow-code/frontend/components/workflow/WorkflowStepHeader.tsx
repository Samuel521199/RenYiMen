"use client";

import type React from "react";

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
        <h2 className="text-lg font-semibold text-gray-900">
          Step {step} — {title}
        </h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

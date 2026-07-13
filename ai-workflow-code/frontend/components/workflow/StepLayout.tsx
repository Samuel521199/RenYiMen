"use client";

import type React from "react";

import { useLanguage } from "@/lib/LanguageContext";
import {
  ACTIVITY_PRIMARY_BUTTON_CLASS,
  ACTIVITY_SECONDARY_BUTTON_CLASS,
  ACTIVITY_STEP_RAIL_CLASS,
  getActivityStepCardClasses,
} from "@/lib/activity-workflow-theme";

interface StepLayoutProps {
  currentStep: number;
  steps: { label: string }[];
  onNext?: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children: React.ReactNode;
  onStepSelect?: (step: number) => void;
  canVisitStep?: (step: number) => boolean;
}

export default function StepLayout({
  currentStep,
  steps,
  onNext,
  onBack,
  nextLabel,
  nextDisabled = false,
  children,
  onStepSelect,
  canVisitStep,
}: StepLayoutProps) {
  const { t } = useLanguage();
  const resolvedNextLabel = nextLabel ?? t("下一步");

  return (
    <div className="space-y-6">
      <section className={ACTIVITY_STEP_RAIL_CLASS}>
        <div className="grid gap-3 md:grid-cols-4">
          {steps.map((item, index) => {
            const step = index + 1;
            const active = currentStep === step;
            const finished = currentStep > step;
            const clickable = canVisitStep ? canVisitStep(step) : active || finished;

            return (
              <button
                key={item.label}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepSelect?.(step)}
                className={getActivityStepCardClasses({ active, finished, clickable })}
              >
                <div className="text-xs uppercase tracking-wide opacity-70">Step {step}</div>
                <div className="mt-1 font-medium">{item.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      <div>{children}</div>

      {(onBack || onNext) && (
        <div className="flex justify-between gap-3">
          <div>
            {onBack && (
              <button type="button" onClick={onBack} className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
                {t("上一步")}
              </button>
            )}
          </div>
          <div>
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled}
                className={ACTIVITY_PRIMARY_BUTTON_CLASS}
              >
                {resolvedNextLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

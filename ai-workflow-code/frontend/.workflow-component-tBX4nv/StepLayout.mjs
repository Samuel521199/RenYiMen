"use client";
import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
const ACTIVITY_PRIMARY_BUTTON_CLASS = "activity-primary";
const ACTIVITY_SECONDARY_BUTTON_CLASS = "activity-secondary";
const ACTIVITY_STEP_RAIL_CLASS = "activity-step-rail";
function getActivityStepCardClasses({ active, finished, clickable }) {
    return [active ? "active" : "", finished ? "finished" : "", clickable ? "clickable" : "locked"].filter(Boolean).join(" ");
}
export default function StepLayout({ currentStep, steps, onNext, onBack, nextLabel = "下一步", nextDisabled = false, children, onStepSelect, canVisitStep, }) {
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: ACTIVITY_STEP_RAIL_CLASS, children: _jsx("div", { className: "grid gap-3 md:grid-cols-4", children: steps.map((item, index) => {
                        const step = index + 1;
                        const active = currentStep === step;
                        const finished = currentStep > step;
                        const clickable = canVisitStep ? canVisitStep(step) : active || finished;
                        return (_jsxs("button", { type: "button", disabled: !clickable, onClick: () => clickable && onStepSelect?.(step), className: getActivityStepCardClasses({ active, finished, clickable }), children: [_jsxs("div", { className: "text-xs uppercase tracking-wide opacity-70", children: ["Step ", step] }), _jsx("div", { className: "mt-1 font-medium", children: item.label })] }, item.label));
                    }) }) }), _jsx("div", { children: children }), (onBack || onNext) && (_jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("div", { children: onBack && (_jsx("button", { type: "button", onClick: onBack, className: ACTIVITY_SECONDARY_BUTTON_CLASS, children: "\u4E0A\u4E00\u6B65" })) }), _jsx("div", { children: onNext && (_jsx("button", { type: "button", onClick: onNext, disabled: nextDisabled, className: ACTIVITY_PRIMARY_BUTTON_CLASS, children: nextLabel })) })] }))] }));
}

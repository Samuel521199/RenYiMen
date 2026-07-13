"use client";
import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
export default function WorkflowStepHeader({ step, title, description, actions, }) {
    return (_jsxs("div", { className: "mb-6 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("h2", { className: "text-lg font-semibold text-gray-900", children: ["Step ", step, " \u2014 ", title] }), description && _jsx("p", { className: "mt-1 text-sm text-gray-500", children: description })] }), actions] }));
}

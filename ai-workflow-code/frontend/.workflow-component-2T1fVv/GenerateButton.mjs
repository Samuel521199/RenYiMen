"use client";
import { jsx as _jsx } from "react/jsx-runtime";
const ACTIVITY_PRIMARY_BUTTON_CLASS = "activity-primary";
export default function GenerateButton({ onClick, loading, disabled = false, label = "开始生成", loadingLabel = "生成中...", className = "", }) {
    return (_jsx("button", { type: "button", onClick: onClick, disabled: disabled || loading, className: `${ACTIVITY_PRIMARY_BUTTON_CLASS} ${className}`.trim(), children: loading ? loadingLabel : label }));
}

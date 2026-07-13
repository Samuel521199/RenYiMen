"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ACTIVITY_INPUT_CLASS = "activity-input";
function modelPrice(model) {
    return Number(model.price_per_image || 0);
}
export default function ModelSelector({ models, value, onChange, loading = false, showPrice = true, disabled = false, label = "模型选择", loadingText = "正在加载模型…", }) {
    const selectedModel = models.find((model) => model.id === value) || null;
    return (_jsxs("div", { className: "grid gap-3", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: label }), _jsxs("select", { value: value || "", onChange: (event) => onChange(Number(event.target.value) || 0), disabled: loading || disabled, className: ACTIVITY_INPUT_CLASS, children: [_jsx("option", { value: "", children: "\u8BF7\u9009\u62E9\u6A21\u578B" }), models.map((model) => (_jsx("option", { value: model.id, children: model.name }, model.id)))] })] }), showPrice && selectedModel && (_jsxs("p", { className: "text-sm text-gray-500", children: [selectedModel.provider, " \u00B7 $", modelPrice(selectedModel).toFixed(4)] })), loading && _jsx("p", { className: "text-sm text-gray-500", children: loadingText })] }));
}

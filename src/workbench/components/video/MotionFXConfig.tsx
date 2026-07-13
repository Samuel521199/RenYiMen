"use client";

import { useLanguage } from "@workbench/lib/LanguageContext";
import { useMemo } from "react";

export interface MotionFXPreset {
  id: string;
  nameZh: string;
  nameEn: string;
  emoji: string;
  description: string;
  camera: string;
  text: string;
  cta: string;
  global?: string;
}

export const MOTION_FX_PRESETS: MotionFXPreset[] = [
  {
    id: "reward",
    nameZh: "奖励类",
    nameEn: "Reward",
    emoji: "🎯",
    description: "慢推镜头 + 弹出字幕 + 按钮呼吸",
    camera: "cam_slow_push",
    text: "txt_pop",
    cta: "cta_pulse",
    global: "global_flash",
  },
  {
    id: "emotion",
    nameZh: "情绪类",
    nameEn: "Emotion",
    emoji: "😱",
    description: "微震动镜头 + 弹出字幕",
    camera: "cam_micro_shake",
    text: "txt_pop",
    cta: "cta_pulse",
  },
  {
    id: "notify",
    nameZh: "通知类",
    nameEn: "Notification",
    emoji: "📢",
    description: "淡入 + 通知闪烁",
    camera: "cam_slow_push",
    text: "txt_fade",
    cta: "cta_pulse",
    global: "global_flash",
  },
  {
    id: "custom",
    nameZh: "自定义",
    nameEn: "Custom",
    emoji: "⚙",
    description: "自选动效组合",
    camera: "",
    text: "",
    cta: "",
  },
];

const CAMERA_OPTIONS = [
  { value: "cam_slow_push", label: "慢推 Slow Push" },
  { value: "cam_zoom_in", label: "轻放大 Zoom In" },
  { value: "cam_micro_shake", label: "微震动 Micro Shake" },
  { value: "cam_zoom_out", label: "轻缩小 Zoom Out" },
];

const TEXT_OPTIONS = [
  { value: "txt_pop", label: "弹出 Pop In" },
  { value: "txt_fade", label: "淡入 Fade In" },
];

const CTA_OPTIONS = [{ value: "cta_pulse", label: "呼吸 Pulse" }];

const GLOBAL_OPTIONS = [
  { value: "", label: "无 None" },
  { value: "global_flash", label: "柔光闪 Soft Flash" },
  { value: "global_brightness", label: "亮度脉冲 Brightness Pulse" },
];

interface Props {
  presetId?: string;
  camera?: string;
  textFx?: string;
  cta?: string;
  global?: string;
  compact?: boolean;
  presetOrder?: string[];
  presetStats?: Record<string, { winRate: number; samples: number }>;
  onPresetSelect: (preset: MotionFXPreset) => void;
  onParamChange: (key: string, value: string) => void;
}

export default function MotionFXConfig({
  presetId,
  camera = "",
  textFx = "",
  cta = "",
  global = "",
  compact = false,
  presetOrder,
  presetStats,
  onPresetSelect,
  onParamChange,
}: Props) {
  const { t, lang } = useLanguage();
  const isCustom = presetId === "custom";
  const orderedPresets = useMemo(() => {
    if (!presetOrder?.length) return MOTION_FX_PRESETS;
    const rank = new Map(presetOrder.map((id, index) => [id, index]));
    return [...MOTION_FX_PRESETS].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }, [presetOrder]);

  return (
    <div>
      {!compact && (
        <>
          <h2 className="mb-1 text-base font-semibold text-gray-900">{t("动效配置")}</h2>
          <p className="mb-5 text-sm text-gray-500">{t("动效配置说明")}</p>
        </>
      )}

      <div className={`${compact ? "" : "mb-6"} grid grid-cols-2 gap-3 sm:grid-cols-4`}>
        {orderedPresets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onPresetSelect(preset)}
            className={`flex flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all ${
              presetId === preset.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-200"
            }`}
          >
            <span className="text-2xl">{preset.emoji}</span>
            <span className="text-sm font-medium text-gray-900">{lang === "zh" ? preset.nameZh : preset.nameEn}</span>
            <span className="text-xs leading-tight text-gray-500">{preset.description}</span>
            {presetStats?.[preset.id]?.samples ? (
              <span className="text-[11px] text-blue-500">
                {lang === "zh"
                  ? `命中率 ${presetStats[preset.id].winRate}% · 样本 ${presetStats[preset.id].samples}`
                  : `Hit ${presetStats[preset.id].winRate}% · ${presetStats[preset.id].samples} samples`}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {!compact && presetId && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t("动效参数")} {!isCustom && <span className="text-blue-500">({t("预设已锁定，可调整")})</span>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">🎥 {t("镜头动效")}</label>
              <select
                value={camera}
                onChange={(event) => onParamChange("camera", event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t("无")}</option>
                {CAMERA_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">🔤 {t("文字动效")}</label>
              <select
                value={textFx}
                onChange={(event) => onParamChange("text", event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t("无")}</option>
                {TEXT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">🧲 {t("CTA 动效")}</label>
              <select
                value={cta}
                onChange={(event) => onParamChange("cta", event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t("无")}</option>
                {CTA_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">🌗 {t("全局动效")}</label>
              <select
                value={global}
                onChange={(event) => onParamChange("global", event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                {GLOBAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3 text-xs text-gray-400">⚠ {t("动效规则提示")}</div>
        </div>
      )}
    </div>
  );
}

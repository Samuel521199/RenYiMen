import {
  WB_CARD_CLASS,
  WB_INPUT_CLASS,
  WB_PAGE_TEXT_CLASS,
  WB_PANEL_CLASS,
  WB_PRIMARY_BUTTON_CLASS,
  WB_SECONDARY_BUTTON_CLASS,
  WB_SECTION_CLASS,
} from "./workbench-ui-theme";

export const ACTIVITY_PAGE_SHELL_CLASS = WB_PAGE_TEXT_CLASS;
export const ACTIVITY_PAGE_INNER_CLASS = "mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8";
export const ACTIVITY_STEP_RAIL_CLASS = `${WB_SECTION_CLASS} p-4`;
export const ACTIVITY_SECTION_CARD_CLASS = WB_SECTION_CLASS;
export const ACTIVITY_PANEL_CLASS = WB_PANEL_CLASS;
export const ACTIVITY_INPUT_CLASS = WB_INPUT_CLASS;
export const ACTIVITY_SECONDARY_BUTTON_CLASS = `${WB_SECONDARY_BUTTON_CLASS} px-5 py-2`;
export const ACTIVITY_PRIMARY_BUTTON_CLASS = `${WB_PRIMARY_BUTTON_CLASS} px-5 py-2 disabled:bg-slate-700 disabled:text-slate-500`;

export function getActivityStepCardClasses({
  active,
  finished,
  clickable,
}: {
  active: boolean;
  finished: boolean;
  clickable: boolean;
}): string {
  const stateClasses = active
    ? "border-emerald-500 bg-emerald-600 text-white"
    : finished
      ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
      : "border-white/10 bg-[#111827] text-slate-500";

  return `rounded-lg border px-3 py-2 text-left text-sm transition ${stateClasses} ${
    clickable ? "hover:border-emerald-400/60 hover:text-slate-200" : "cursor-not-allowed opacity-70"
  }`;
}

export function getActivityTemplateTypeTabClasses(active: boolean): string {
  return `rounded-md border px-3 py-2 text-sm ${
    active
      ? "border-emerald-500 bg-emerald-600 text-white"
      : "border-white/10 bg-[#111827] text-slate-400 hover:border-emerald-500/40 hover:text-slate-200"
  }`;
}

export function getActivityTemplateCardClasses(selected: boolean): string {
  return `rounded-lg border p-4 text-left transition ${
    selected
      ? "border-emerald-500/50 bg-emerald-950/30"
      : "border-white/10 bg-[#0f1728] hover:border-emerald-500/40"
  }`;
}

/** @deprecated use WB_CARD_CLASS */
export { WB_CARD_CLASS as ACTIVITY_LEGACY_CARD_CLASS };

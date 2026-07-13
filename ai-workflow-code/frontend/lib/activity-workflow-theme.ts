export const ACTIVITY_PAGE_SHELL_CLASS = "text-gray-900";
export const ACTIVITY_PAGE_INNER_CLASS = "mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8";
export const ACTIVITY_STEP_RAIL_CLASS = "rounded-xl border border-gray-200 bg-white p-4 shadow-sm";
export const ACTIVITY_SECTION_CARD_CLASS = "rounded-xl border border-gray-200 bg-white p-5 shadow-sm";
export const ACTIVITY_PANEL_CLASS = "rounded-lg border border-gray-200 bg-gray-50 p-4";
export const ACTIVITY_INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500";
export const ACTIVITY_SECONDARY_BUTTON_CLASS =
  "rounded-md border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:border-emerald-500";
export const ACTIVITY_PRIMARY_BUTTON_CLASS =
  "rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-400";

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
    ? "border-emerald-500 bg-emerald-500 text-white"
    : finished
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-gray-200 bg-white text-gray-400";

  return `rounded-lg border px-3 py-2 text-left text-sm transition ${stateClasses} ${
    clickable ? "hover:border-emerald-400" : "cursor-not-allowed opacity-70"
  }`;
}

export function getActivityTemplateTypeTabClasses(active: boolean): string {
  return `rounded-md border px-3 py-2 text-sm ${
    active
      ? "border-emerald-500 bg-emerald-500 text-white"
      : "border-gray-200 bg-white text-gray-600 hover:border-emerald-400"
  }`;
}

export function getActivityTemplateCardClasses(selected: boolean): string {
  return `rounded-lg border p-4 text-left transition ${
    selected
      ? "border-emerald-500 bg-emerald-50"
      : "border-gray-200 bg-white hover:border-emerald-400"
  }`;
}

export type WorkbenchToolGroup = "video-generation" | "video-editing" | "audio-post";

export const WORKBENCH_TOOL_SECTION_EVENT = "workbench:tool-section-change";
export const WORKFLOW_STUDIO_HISTORY_STATE_KEY = "__workflowStudioSkuId";

export type WorkbenchToolSectionEventDetail = {
  group: WorkbenchToolGroup | null;
};

export function readWorkbenchToolGroup(value: string | null): WorkbenchToolGroup | null {
  return value === "video-generation" || value === "video-editing" || value === "audio-post"
    ? value
    : null;
}

export function navigateWorkbenchToolSection(href: string): void {
  const url = new URL(href, window.location.href);
  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const currentState = window.history.state && typeof window.history.state === "object"
    ? { ...window.history.state }
    : {};

  delete currentState[WORKFLOW_STUDIO_HISTORY_STATE_KEY];
  if (currentHref === nextHref) {
    window.history.replaceState(currentState, "", nextHref);
  } else {
    window.history.pushState(currentState, "", nextHref);
  }

  window.dispatchEvent(new CustomEvent<WorkbenchToolSectionEventDetail>(WORKBENCH_TOOL_SECTION_EVENT, {
    detail: { group: readWorkbenchToolGroup(url.searchParams.get("group")) },
  }));
}

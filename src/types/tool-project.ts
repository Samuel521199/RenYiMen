export interface ToolProjectRecord {
  id: string;
  userId: string;
  skuId: string;
  name: string;
  formState: unknown;
  outputState: unknown;
  activeTaskId: string | null;
  providerCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolProjectOutputState {
  captionedVideoUrl?: string;
  subtitleState?: "idle" | "processing" | "success" | "error";
  subtitleError?: string;
}

import { inferMediaTypeFromResultUrl } from "@/lib/task-status-view";
import type { TaskStatusPollData } from "@/types/task-status";
import {
  isTemporaryDashScopeUrl,
  persistRemoteMediaToOss,
} from "@/services/video-orchestrator/oss-media";

type PersistMedia = typeof persistRemoteMediaToOss;

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 160) || "unknown";
}

export async function persistTemporaryHistoryVideo(params: {
  userId: string;
  taskId: string;
  resultUrl: string;
  mediaType?: string | null;
  persistMedia?: PersistMedia;
}): Promise<string> {
  const mediaType = params.mediaType || inferMediaTypeFromResultUrl(params.resultUrl);
  if (mediaType !== "video" || !isTemporaryDashScopeUrl(params.resultUrl)) {
    return params.resultUrl;
  }

  const persistMedia = params.persistMedia ?? persistRemoteMediaToOss;
  return persistMedia({
    url: params.resultUrl,
    key: `generation-history/${safePathPart(params.userId)}/${safePathPart(params.taskId)}.mp4`,
    fallbackContentType: "video/mp4",
  });
}

export async function persistTemporaryPollVideo(params: {
  userId: string;
  taskId: string;
  pollData: TaskStatusPollData;
  persistMedia?: PersistMedia;
}): Promise<TaskStatusPollData> {
  const { pollData } = params;
  if (pollData.status !== "succeeded" || !pollData.resultUrl?.trim()) return pollData;

  const originalUrl = pollData.resultUrl.trim();
  const persistedUrl = await persistTemporaryHistoryVideo({
    userId: params.userId,
    taskId: params.taskId,
    resultUrl: originalUrl,
    mediaType: pollData.resultMediaType,
    persistMedia: params.persistMedia,
  });
  if (persistedUrl === originalUrl) return pollData;

  const resultUrls = pollData.resultUrls?.map((url) => url === originalUrl ? persistedUrl : url);
  return {
    ...pollData,
    resultUrl: persistedUrl,
    ...(resultUrls ? { resultUrls } : {}),
  };
}

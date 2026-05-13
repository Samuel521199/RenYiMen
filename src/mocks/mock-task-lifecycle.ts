import type { TaskStatusPollData } from "@/types/task-status";

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

type MockEntry = { n: number };

const lifecycle = new Map<string, MockEntry>();

export function resetMockTaskLifecycle(taskId: string) {
  lifecycle.delete(taskId);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 模拟任务状态机：queued → running（带 progress）→ succeeded / failed。
 * `taskId` 包含 `fail` 时走向失败终态，用于演示错误 UI。
 */
export async function mockPollTaskStatus(
  taskId: string,
  signal: AbortSignal
): Promise<TaskStatusPollData> {
  await delay(400, signal);

  let entry = lifecycle.get(taskId);
  if (!entry) {
    entry = { n: 0 };
    lifecycle.set(taskId, entry);
  }
  entry.n += 1;
  const step = entry.n;

  const failMode = taskId.toLowerCase().includes("fail");

  if (failMode) {
    if (step <= 2) return { status: "queued", progress: 0 };
    if (step <= 6) return { status: "running", progress: Math.min(92, 10 + step * 14) };
    return {
      status: "failed",
      progress: null,
      errorMessage: "模拟：推理节点显存不足（CUDA OOM）。您的表单参数已保留，可直接重试或稍后再试。",
    };
  }

  if (step === 1) return { status: "queued", progress: 0 };
  if (step < 12) return { status: "running", progress: Math.min(97, 8 + step * 8) };
  return {
    status: "succeeded",
    progress: 100,
    resultUrl: SAMPLE_VIDEO,
  };
}

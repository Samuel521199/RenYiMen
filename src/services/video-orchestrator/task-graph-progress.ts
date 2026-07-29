export type ProjectTaskStatus =
  | "blocked"
  | "waiting_capacity"
  | "reserved"
  | "upstream_accepted"
  | "running"
  | "quality_checking"
  | "retrying"
  | "awaiting_review"
  | "completed"
  | "cancelled"
  | "failed";

export type ProjectTaskType =
  | "planning"
  | "review_gate"
  | "asset_image"
  | "boundary_image"
  | "micro_shot_image"
  | "segment_video"
  | "composition";

export interface ProjectTaskGraphNode {
  id: string;
  type: ProjectTaskType;
  targetId: string;
  labelZh: string;
  labelEn: string;
  required: boolean;
  active: boolean;
  weight: number;
  status: ProjectTaskStatus;
  dependencyIds: string[];
  upstreamAccepted: boolean;
  upstreamTaskId?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  retryReason?: string;
  correctionStrategy?: string;
  estimatedDurationMs?: number;
  progressRatio?: number;
}

export interface ProjectTaskGraphSnapshot {
  version: "project-task-graph-v1";
  generatedAt: string;
  currentNode: string | null;
  status: ProjectTaskStatus | "idle";
  progress: {
    percent: number;
    completed: number;
    total: number;
  };
  allowedActions: Array<
    | "WAIT_FOR_WORKER"
    | "APPROVE_CURRENT_NODE"
    | "RESUME_CURRENT_NODE"
    | "EXECUTE_RECOVERY_ACTION"
  >;
  recoveryAction: string | null;
  nodes: ProjectTaskGraphNode[];
  completedWeight: number;
  totalWeight: number;
  percent: number;
  requiredTaskCount: number;
  completedTaskCount: number;
  cancelledTaskCount: number;
  currentBlockerIds: string[];
  currentBlockers: Array<{
    id: string;
    labelZh: string;
    labelEn: string;
    status: ProjectTaskStatus;
    upstreamAccepted: boolean;
    upstreamTaskId?: string;
    elapsedMs?: number;
    attempt: number;
    retryReason?: string;
    correctionStrategy?: string;
  }>;
  criticalPathNodeIds: string[];
  estimatedRemainingMs?: {
    low: number;
    high: number;
    confidence: "low" | "medium" | "high";
  };
  etaUnavailableReasonZh?: string;
  etaUnavailableReasonEn?: string;
}

const STATUS_RATIO: Record<ProjectTaskStatus, number> = {
  blocked: 0,
  waiting_capacity: 0,
  reserved: 0.05,
  upstream_accepted: 0.1,
  running: 0.2,
  quality_checking: 0.85,
  retrying: 0.15,
  awaiting_review: 0,
  completed: 1,
  cancelled: 0,
  failed: 0,
};

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function taskNodeElapsedMs(node: ProjectTaskGraphNode, nowMs: number): number | undefined {
  const startedAt = parseTime(node.startedAt) ?? parseTime(node.queuedAt);
  if (startedAt == null) return undefined;
  const end = parseTime(node.completedAt) ?? nowMs;
  return Math.max(0, end - startedAt);
}

export function projectTaskNodeProgressRatio(node: ProjectTaskGraphNode, nowMs: number): number {
  if (node.progressRatio != null) return Math.max(0, Math.min(1, node.progressRatio));
  if (node.status !== "running") return STATUS_RATIO[node.status];
  const elapsed = taskNodeElapsedMs(node, nowMs) ?? 0;
  const estimate = Math.max(1, node.estimatedDurationMs ?? node.weight);
  // Runtime may advance a running task, but never claims completion before
  // provider output and validation actually arrive.
  return Math.min(0.8, 0.2 + (elapsed / estimate) * 0.6);
}

function taskRemainingMs(node: ProjectTaskGraphNode, nowMs: number): number {
  if (!node.active || !node.required || node.status === "completed" || node.status === "cancelled") return 0;
  const estimate = Math.max(1, node.estimatedDurationMs ?? node.weight);
  return Math.max(0, estimate * (1 - projectTaskNodeProgressRatio(node, nowMs)));
}

function criticalPath(
  nodes: ProjectTaskGraphNode[],
  nowMs: number,
): { totalMs: number; nodeIds: string[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memo = new Map<string, { totalMs: number; nodeIds: string[] }>();
  const visiting = new Set<string>();
  const visit = (id: string): { totalMs: number; nodeIds: string[] } => {
    const cached = memo.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || !node.active || !node.required || visiting.has(id)) return { totalMs: 0, nodeIds: [] };
    visiting.add(id);
    const dependencyPath = node.dependencyIds
      .map(visit)
      .sort((left, right) => right.totalMs - left.totalMs)[0] ?? { totalMs: 0, nodeIds: [] };
    visiting.delete(id);
    const ownRemainingMs = taskRemainingMs(node, nowMs);
    const result = {
      totalMs: dependencyPath.totalMs + ownRemainingMs,
      nodeIds: ownRemainingMs > 0
        ? [...dependencyPath.nodeIds, node.id]
        : dependencyPath.nodeIds,
    };
    memo.set(id, result);
    return result;
  };
  return nodes
    .filter((node) => node.active && node.required)
    .map((node) => visit(node.id))
    .sort((left, right) => right.totalMs - left.totalMs)[0] ?? { totalMs: 0, nodeIds: [] };
}

export function computeProjectTaskGraphSnapshot(
  inputNodes: ProjectTaskGraphNode[],
  options: { nowMs?: number; durationSampleCount?: number } = {},
): ProjectTaskGraphSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const nodes = inputNodes.map((node) => ({
    ...node,
    weight: Math.max(1, node.weight),
    attempt: Math.max(0, Math.round(node.attempt || 0)),
    dependencyIds: [...new Set(node.dependencyIds)],
  }));
  const activeRequired = nodes.filter((node) => node.active && node.required);
  const totalWeight = activeRequired.reduce((sum, node) => sum + node.weight, 0);
  const completedWeight = activeRequired.reduce(
    (sum, node) => sum + (node.status === "completed" ? node.weight : 0),
    0,
  );
  const progressedWeight = activeRequired.reduce((sum, node) => {
    if (node.status === "completed") return sum + node.weight;
    if (node.progressRatio == null) return sum;
    return sum + node.weight * Math.max(0, Math.min(1, node.progressRatio));
  }, 0);
  const percent = totalWeight > 0
    ? Math.max(0, Math.min(100, Math.round((progressedWeight / totalWeight) * 1000) / 10))
    : 0;
  const incomplete = activeRequired.filter((node) => node.status !== "completed");
  const directlyRunnable = incomplete.filter((node) =>
    node.dependencyIds.every((dependencyId) => byStatus(nodes, dependencyId) === "completed")
  );
  const blockers = (directlyRunnable.length ? directlyRunnable : incomplete)
    .sort((left, right) =>
      blockerPriority(left.status) - blockerPriority(right.status)
      || left.id.localeCompare(right.id)
    )
    .slice(0, 3);
  const path = criticalPath(nodes, nowMs);
  const manualBlocker = incomplete.find((node) => node.status === "awaiting_review");
  const currentNode = blockers[0] ?? null;
  const failedNode = blockers.find((node) => node.status === "failed");
  const recoveryAction = failedNode ? "RETRY_CURRENT_NODE" : null;
  const allowedActions: ProjectTaskGraphSnapshot["allowedActions"] = currentNode
    ? currentNode.status === "awaiting_review"
      ? ["APPROVE_CURRENT_NODE"]
      : currentNode.status === "failed"
        ? ["EXECUTE_RECOVERY_ACTION"]
        : currentNode.status === "blocked"
          ? ["RESUME_CURRENT_NODE"]
          : ["WAIT_FOR_WORKER"]
    : [];
  const samples = Math.max(0, options.durationSampleCount ?? 0);
  const confidence = samples >= 8 ? "high" : samples >= 3 ? "medium" : "low";
  const rangeMultiplier = confidence === "high"
    ? [0.85, 1.2]
    : confidence === "medium"
      ? [0.7, 1.4]
      : [0.55, 1.8];

  return {
    version: "project-task-graph-v1",
    generatedAt: new Date(nowMs).toISOString(),
    currentNode: currentNode?.id ?? null,
    status: currentNode?.status ?? "idle",
    progress: {
      percent,
      completed: activeRequired.filter((node) => node.status === "completed").length,
      total: activeRequired.length,
    },
    allowedActions,
    recoveryAction,
    nodes,
    completedWeight: Math.round(completedWeight),
    totalWeight: Math.round(totalWeight),
    percent,
    requiredTaskCount: activeRequired.length,
    completedTaskCount: activeRequired.filter((node) => node.status === "completed").length,
    cancelledTaskCount: nodes.filter((node) => node.status === "cancelled").length,
    currentBlockerIds: blockers.map((node) => node.id),
    currentBlockers: blockers.map((node) => ({
      id: node.id,
      labelZh: node.labelZh,
      labelEn: node.labelEn,
      status: node.status,
      upstreamAccepted: node.upstreamAccepted,
      upstreamTaskId: node.upstreamTaskId,
      elapsedMs: taskNodeElapsedMs(node, nowMs),
      attempt: node.attempt,
      retryReason: node.retryReason,
      correctionStrategy: node.correctionStrategy,
    })),
    criticalPathNodeIds: path.nodeIds,
    ...(!manualBlocker && path.totalMs > 0
      ? {
          estimatedRemainingMs: {
            low: Math.round(path.totalMs * rangeMultiplier[0]),
            high: Math.round(path.totalMs * rangeMultiplier[1]),
            confidence,
          },
        }
      : manualBlocker
        ? {
            etaUnavailableReasonZh: `等待人工操作：${manualBlocker.labelZh}`,
            etaUnavailableReasonEn: `Waiting for manual action: ${manualBlocker.labelEn}`,
          }
        : {}),
  };
}

function byStatus(nodes: ProjectTaskGraphNode[], id: string): ProjectTaskStatus | undefined {
  return nodes.find((node) => node.id === id)?.status;
}

function blockerPriority(status: ProjectTaskStatus): number {
  if (status === "failed") return 0;
  if (status === "retrying") return 1;
  if (status === "waiting_capacity" || status === "reserved") return 2;
  if (status === "upstream_accepted" || status === "running" || status === "quality_checking") return 3;
  if (status === "awaiting_review") return 4;
  return 5;
}

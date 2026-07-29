export type JsonStageStreamContentMode =
  | "none"
  | "delta"
  | "cumulative"
  | "mixed";

export type JsonStageStreamAssemblyMetrics = {
  contentMode: JsonStageStreamContentMode;
  deltaChunkCount: number;
  consecutiveDuplicateDeltaCount: number;
  cumulativeSnapshotCount: number;
  duplicateCumulativeSnapshotCount: number;
  cumulativeRegressionCount: number;
  cumulativeDivergenceCount: number;
  mixedModeIgnoredSnapshotCount: number;
};

type AppendStreamContentInput = {
  choiceIndex: number;
  deltaContent?: string;
  messageContent?: string;
};

/**
 * OpenAI-compatible streams normally return incremental delta.content pieces.
 * Some providers instead return cumulative message.content snapshots. Treating
 * those snapshots as deltas duplicates the whole answer on every event.
 */
export class JsonStageStreamAssembler {
  private readonly contentParts: string[] = [];
  private readonly cumulativeByChoice = new Map<number, string>();
  private previousDelta = "";
  private sawDelta = false;
  private sawCumulative = false;
  private deltaChunkCount = 0;
  private consecutiveDuplicateDeltaCount = 0;
  private cumulativeSnapshotCount = 0;
  private duplicateCumulativeSnapshotCount = 0;
  private cumulativeRegressionCount = 0;
  private cumulativeDivergenceCount = 0;
  private mixedModeIgnoredSnapshotCount = 0;

  append(input: AppendStreamContentInput): string {
    if (typeof input.deltaContent === "string" && input.deltaContent) {
      this.sawDelta = true;
      this.deltaChunkCount += 1;
      if (input.deltaContent === this.previousDelta) {
        // Repeated delta tokens can be semantically valid, so observe but do not
        // remove them. Only cumulative snapshots are safe to de-duplicate.
        this.consecutiveDuplicateDeltaCount += 1;
      }
      this.previousDelta = input.deltaContent;
      this.contentParts.push(input.deltaContent);
      return input.deltaContent;
    }

    if (typeof input.messageContent !== "string" || !input.messageContent) {
      return "";
    }

    this.sawCumulative = true;
    this.cumulativeSnapshotCount += 1;
    const snapshot = input.messageContent;
    const previousSnapshot = this.cumulativeByChoice.get(input.choiceIndex) ?? "";
    const assembled = this.content();

    if (this.sawDelta) {
      if (snapshot.startsWith(assembled)) {
        const suffix = snapshot.slice(assembled.length);
        this.cumulativeByChoice.set(input.choiceIndex, snapshot);
        if (suffix) this.contentParts.push(suffix);
        else this.duplicateCumulativeSnapshotCount += 1;
        return suffix;
      }
      if (assembled.startsWith(snapshot)) {
        this.cumulativeRegressionCount += 1;
      } else {
        this.cumulativeDivergenceCount += 1;
      }
      this.mixedModeIgnoredSnapshotCount += 1;
      this.cumulativeByChoice.set(input.choiceIndex, snapshot);
      return "";
    }

    if (!previousSnapshot) {
      this.cumulativeByChoice.set(input.choiceIndex, snapshot);
      this.contentParts.push(snapshot);
      return snapshot;
    }
    if (snapshot.startsWith(previousSnapshot)) {
      const suffix = snapshot.slice(previousSnapshot.length);
      this.cumulativeByChoice.set(input.choiceIndex, snapshot);
      if (suffix) this.contentParts.push(suffix);
      else this.duplicateCumulativeSnapshotCount += 1;
      return suffix;
    }
    if (previousSnapshot.startsWith(snapshot)) {
      this.cumulativeRegressionCount += 1;
      return "";
    }

    // A divergent message.content stream is not a cumulative snapshot stream.
    // Preserve backward compatibility by treating the piece as a delta, while
    // exposing the divergence in telemetry for provider-specific correction.
    this.cumulativeDivergenceCount += 1;
    this.cumulativeByChoice.set(input.choiceIndex, `${previousSnapshot}${snapshot}`);
    this.contentParts.push(snapshot);
    return snapshot;
  }

  content(): string {
    return this.contentParts.join("");
  }

  metrics(): JsonStageStreamAssemblyMetrics {
    return {
      contentMode: this.sawDelta && this.sawCumulative
        ? "mixed"
        : this.sawDelta
          ? "delta"
          : this.sawCumulative
            ? "cumulative"
            : "none",
      deltaChunkCount: this.deltaChunkCount,
      consecutiveDuplicateDeltaCount: this.consecutiveDuplicateDeltaCount,
      cumulativeSnapshotCount: this.cumulativeSnapshotCount,
      duplicateCumulativeSnapshotCount: this.duplicateCumulativeSnapshotCount,
      cumulativeRegressionCount: this.cumulativeRegressionCount,
      cumulativeDivergenceCount: this.cumulativeDivergenceCount,
      mixedModeIgnoredSnapshotCount: this.mixedModeIgnoredSnapshotCount,
    };
  }
}

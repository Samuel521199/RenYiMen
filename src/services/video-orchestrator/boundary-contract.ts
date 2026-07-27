import type {
  OnePromptVideoPlan,
  VideoBoundaryContract,
  VideoBoundaryContractStatus,
} from "./types";

export function deriveCanonicalBoundaryContracts(
  plan: Pick<
    OnePromptVideoPlan,
    "keyframes" | "segments" | "candidateTimeline" | "storyboardBrief"
  >,
): VideoBoundaryContract[] {
  const timelineBySegment = new Map(
    (plan.candidateTimeline ?? []).map((item) => [item.segmentNo, item]),
  );
  const briefBySegment = new Map(
    (plan.storyboardBrief ?? []).map((item) => [item.segmentNo, item]),
  );

  return [...plan.keyframes]
    .sort((a, b) => a.keyframeNo - b.keyframeNo)
    .map((keyframe) => {
      const previous = plan.segments.find(
        (segment) => segment.endKeyframeNo === keyframe.keyframeNo,
      );
      const next = plan.segments.find(
        (segment) => segment.startKeyframeNo === keyframe.keyframeNo,
      );
      const ownerSegmentNo = previous?.segmentNo ?? next?.segmentNo;
      if (!ownerSegmentNo) {
        throw new Error(
          `Boundary keyframe ${keyframe.keyframeNo} is not connected to any segment.`,
        );
      }
      const adjacentSegmentNos = [previous?.segmentNo, next?.segmentNo]
        .filter((value): value is number => Number.isInteger(value));
      const sourceEventIds = unique(
        adjacentSegmentNos.flatMap((segmentNo) => [
          ...(timelineBySegment.get(segmentNo)?.sourceEventIds ?? []),
          ...(briefBySegment.get(segmentNo)?.sourceEventIds ?? []),
          ...(briefBySegment.get(segmentNo)?.eventIds ?? []),
        ]),
      );
      const linkedBeatIds = unique(
        adjacentSegmentNos.flatMap((segmentNo) => [
          ...(briefBySegment.get(segmentNo)?.linkedBeatIds ?? []),
        ]),
      );
      const requiredAnchorIds = unique([
        ...(keyframe.effectiveRequiredAnchorIds ?? []),
        ...(keyframe.usesConsistencyAnchors ?? []),
        ...adjacentSegmentNos.flatMap((segmentNo) => [
          ...(timelineBySegment.get(segmentNo)?.requiredAnchorIds ?? []),
          ...(briefBySegment.get(segmentNo)?.requiredAnchorIds ?? []),
          ...(briefBySegment.get(segmentNo)?.visibleAnchorIds ?? []),
        ]),
      ]);
      const cameraId = next
        ? briefBySegment.get(next.segmentNo)?.cameraId
        : previous
          ? briefBySegment.get(previous.segmentNo)?.cameraId
          : undefined;

      return {
        version: "boundary-contract-v1",
        keyframeNo: keyframe.keyframeNo,
        timeSeconds: keyframe.timeSeconds,
        ownerSegmentNo,
        previousSegmentNo: previous?.segmentNo,
        nextSegmentNo: next?.segmentNo,
        sourceEventIds,
        linkedBeatIds,
        requiredAnchorIds,
        approvedAssetReferenceIds: [],
        storyState: keyframe.purpose,
        scene: keyframe.scene,
        cameraId,
        characterState: keyframe.characterState,
        productState: keyframe.productState,
        compositionIntent: keyframe.frameDesign?.composition
          ? JSON.stringify(keyframe.frameDesign.composition)
          : undefined,
        immutableFields: [
          "storyState",
          "scene",
          "characterState",
          "productState",
          "requiredAnchorIds",
        ],
        forbiddenStoryStates: [],
        status: "semantic_draft",
      };
    });
}

export function bindBoundaryContractsToApprovedAssets(
  contracts: VideoBoundaryContract[],
  approvedAssetReferenceIds: string[],
  requiredAssetsByBoundary?: Map<number, string[]>,
): VideoBoundaryContract[] {
  const approved = new Set(approvedAssetReferenceIds);
  return contracts.map((contract) => {
    const scoped = requiredAssetsByBoundary?.get(contract.keyframeNo)
      ?? contract.requiredAnchorIds;
    const approvedForBoundary = unique(
      scoped.filter((assetId) => approved.has(assetId)),
    );
    return {
      ...contract,
      approvedAssetReferenceIds: approvedForBoundary,
      status: approvedForBoundary.length === unique(scoped).length
        ? "asset_bound"
        : "semantic_draft",
    };
  });
}

export function setBoundaryContractStatus(
  contracts: VideoBoundaryContract[],
  status: VideoBoundaryContractStatus,
): VideoBoundaryContract[] {
  return contracts.map((contract) => ({ ...contract, status }));
}

export function validateBoundaryContracts(
  plan: Pick<OnePromptVideoPlan, "keyframes" | "segments">,
  contracts: VideoBoundaryContract[],
): void {
  if (contracts.length !== plan.keyframes.length) {
    throw new Error(
      `Expected ${plan.keyframes.length} boundary contracts, received ${contracts.length}.`,
    );
  }
  const seen = new Set<number>();
  for (const contract of contracts) {
    if (seen.has(contract.keyframeNo)) {
      throw new Error(`Duplicate boundary contract for keyframe ${contract.keyframeNo}.`);
    }
    seen.add(contract.keyframeNo);
    const keyframe = plan.keyframes.find(
      (item) => item.keyframeNo === contract.keyframeNo,
    );
    if (!keyframe || Math.abs(keyframe.timeSeconds - contract.timeSeconds) > 0.001) {
      throw new Error(
        `Boundary contract ${contract.keyframeNo} does not match its keyframe time.`,
      );
    }
    const owner = plan.segments.find(
      (segment) => segment.segmentNo === contract.ownerSegmentNo,
    );
    if (
      !owner
      || (owner.startKeyframeNo !== contract.keyframeNo
        && owner.endKeyframeNo !== contract.keyframeNo)
    ) {
      throw new Error(
        `Boundary contract ${contract.keyframeNo} has invalid owner segment ${contract.ownerSegmentNo}.`,
      );
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

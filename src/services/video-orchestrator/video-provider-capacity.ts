/**
 * Backwards-compatible HappyHorse facade. New image, text and visual-QA pools
 * use provider-capacity.ts directly.
 */
import {
  attachUpstreamTaskToProviderLease,
  dashScopeResourceKey,
  heartbeatProviderLease,
  isProviderCapacityError,
  ProviderCapacityError,
  registerProviderDemand,
  releaseProviderLeaseByTaskId,
  requestProviderLease,
  returnProviderLeaseToQueue,
  runningProviderLeaseTaskIds,
  selectFairProviderWaiter,
  type FairProviderWaiter,
  type ProviderLeaseGrant,
  type ProviderSchedulingContext,
} from "./provider-capacity";

export type VideoProviderSchedulingContext = ProviderSchedulingContext;
export type VideoProviderLeaseGrant = ProviderLeaseGrant;
export type FairVideoProviderWaiter = FairProviderWaiter;
export const VideoProviderCapacityError = ProviderCapacityError;
export const selectFairVideoProviderWaiter = selectFairProviderWaiter;
export const isVideoProviderCapacityError = isProviderCapacityError;
export const happyHorseResourceKey = (modelId: string) =>
  dashScopeResourceKey("video_generation", modelId);
export const registerVideoProviderDemand = (
  modelId: string,
  context: ProviderSchedulingContext,
) => registerProviderDemand("video_generation", modelId, context);
export const requestVideoProviderLease = (
  modelId: string,
  context: ProviderSchedulingContext,
) => requestProviderLease("video_generation", modelId, context);
export const attachUpstreamTaskToVideoProviderLease = attachUpstreamTaskToProviderLease;
export const returnVideoProviderLeaseToQueue = returnProviderLeaseToQueue;
export const heartbeatVideoProviderLease = heartbeatProviderLease;
export const releaseVideoProviderLeaseByTaskId = releaseProviderLeaseByTaskId;
export const runningVideoProviderLeaseTaskIds = () =>
  runningProviderLeaseTaskIds("video_generation");

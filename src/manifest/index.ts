import type {
  IUpdatedRepresentationInfo,
  ICodecSupportInfo,
  Period,
  Adaptation,
  Representation,
  ISegment,
  IPeriodsUpdateResult,
  IRepresentationIndex,
  IMetaPlaylistPrivateInfos,
  IPrivateInfos,
  IThumbnailTrack,
} from "./classes";
import type Manifest from "./classes";
import { areSameContent, getLoggableSegmentId } from "./classes";

/** Type of a `Manifest` class. */
export type IManifest = Manifest;

/** Type of a `Period` class. */
export type IPeriod = Period;

/** Type of an `Adaptation` class. */
export type IAdaptation = Adaptation;

/** Type of a `Representation` class. */
export type IRepresentation = Representation;

export type {
  IUpdatedRepresentationInfo,
  ICodecSupportInfo,
  IPeriodsUpdateResult,
  IRepresentationIndex,
  ISegment,
  IMetaPlaylistPrivateInfos,
  IPrivateInfos,
  IThumbnailTrack,
};
export { areSameContent, getLoggableSegmentId };
export type {
  IManifestMetadata,
  IPeriodMetadata,
  IAdaptationMetadata,
  IRepresentationMetadata,
} from "./types";
export { ManifestMetadataFormat } from "./types";
export * from "./utils";

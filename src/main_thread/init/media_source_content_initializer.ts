/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { IMediaElement } from "../../compat/browser_compatibility_types";
import isCodecSupported from "../../compat/is_codec_supported";
import mayMediaElementFailOnUndecipherableData from "../../compat/may_media_element_fail_on_undecipherable_data";
import shouldReloadMediaSourceOnDecipherabilityUpdate from "../../compat/should_reload_media_source_on_decipherability_update";
import config from "../../config";
import type {
  IAdaptiveRepresentationSelectorArguments,
  IRepresentationEstimator,
} from "../../core/adaptive";
import AdaptiveRepresentationSelector from "../../core/adaptive";
import CmcdDataBuilder from "../../core/cmcd";
import {
  CdnPrioritizer,
  createThumbnailFetcher,
  ManifestFetcher,
  SegmentQueueCreator,
} from "../../core/fetchers";
import createContentTimeBoundariesObserver from "../../core/main/common/create_content_time_boundaries_observer";
import type { IFreezeResolution } from "../../core/main/common/FreezeResolver";
import FreezeResolver from "../../core/main/common/FreezeResolver";
import getThumbnailData from "../../core/main/common/get_thumbnail_data";
import synchronizeSegmentSinksOnObservation from "../../core/main/common/synchronize_sinks_on_observation";
import SegmentSinksStore from "../../core/segment_sinks";
import type {
  IStreamOrchestratorOptions,
  IStreamOrchestratorCallbacks,
  INeedsBufferFlushPayload,
} from "../../core/stream";
import StreamOrchestrator from "../../core/stream";
import type { ITextDisplayerInterface } from "../../core/types";
import type { EncryptedMediaError } from "../../errors";
import { MediaError } from "../../errors";
import features from "../../features";
import log from "../../log";
import type { IManifest, IPeriodMetadata, ICodecSupportInfo } from "../../manifest";
import type MainMediaSourceInterface from "../../mse/main_media_source_interface";
import type { IMediaElementPlaybackObserver } from "../../playback_observer";
import type {
  ICmcdOptions,
  IInitialManifest,
  IKeySystemOption,
  IPlayerError,
} from "../../public_types";
import type { IThumbnailResponse, ITransportPipelines } from "../../transports";
import areArraysOfNumbersEqual from "../../utils/are_arrays_of_numbers_equal";
import assert, { assertUnreachable } from "../../utils/assert";
import createCancellablePromise from "../../utils/create_cancellable_promise";
import isNullOrUndefined from "../../utils/is_null_or_undefined";
import noop from "../../utils/noop";
import objectAssign from "../../utils/object_assign";
import type { IReadOnlySharedReference } from "../../utils/reference";
import type { ISyncOrAsyncValue } from "../../utils/sync_or_async";
import SyncOrAsync from "../../utils/sync_or_async";
import type { CancellationSignal } from "../../utils/task_canceller";
import TaskCanceller from "../../utils/task_canceller";
import { ContentDecryptorState, getKeySystemConfiguration } from "../decrypt";
import type { IProcessedProtectionData } from "../decrypt";
import type ContentDecryptor from "../decrypt";
import type { ITextDisplayer } from "../text_displayer";
import type { ITextDisplayerOptions } from "./types";
import { ContentInitializer } from "./types";
import createCorePlaybackObserver from "./utils/create_core_playback_observer";
import createMediaSource from "./utils/create_media_source";
import type { IInitialTimeOptions } from "./utils/get_initial_time";
import getInitialTime from "./utils/get_initial_time";
import getLoadedReference from "./utils/get_loaded_reference";
import performInitialSeekAndPlay from "./utils/initial_seek_and_play";
import initializeContentDecryption from "./utils/initialize_content_decryption";
import MainThreadTextDisplayerInterface from "./utils/main_thread_text_displayer_interface";
import RebufferingController from "./utils/rebuffering_controller";
import StreamEventsEmitter from "./utils/stream_events_emitter";
import listenToMediaError from "./utils/throw_on_media_error";

/**
 * Allows to load a new content thanks to the MediaSource Extensions (a.k.a. MSE)
 * Web APIs.
 *
 * Through this `ContentInitializer`, a Manifest will be fetched (and depending
 * on the situation, refreshed), a `MediaSource` instance will be linked to the
 * wanted `HTMLMediaElement` and chunks of media data, called segments, will be
 * pushed on buffers associated to this `MediaSource` instance.
 *
 * @class MediaSourceContentInitializer
 */
export default class MediaSourceContentInitializer extends ContentInitializer {
  /** Constructor settings associated to this `MediaSourceContentInitializer`. */
  private _initSettings: IInitializeArguments;
  /**
   * `TaskCanceller` allowing to abort everything that the
   * `MediaSourceContentInitializer` is doing.
   */
  private _initCanceller: TaskCanceller;
  /** Interface allowing to fetch and refresh the Manifest. */
  private _manifestFetcher: ManifestFetcher;
  /**
   * Reference to the `Manifest` Object:
   *   - as an asynchronous value if it is still in the process of being loaded.
   *   - as an synchronous value if it has been loaded
   *   - `null` if the load task has not started yet.
   */
  private _manifest: ISyncOrAsyncValue<IManifest> | null;

  private _cmcdDataBuilder: CmcdDataBuilder | null;

  /**
   * Describes the decryption capabilities on the current content, discriminated
   * by a `status` property:
   *
   *   - If set to `"uninitialized"`, decryption capabilities have not been
   *     set up yet.
   *
   *   - If set to `"disabled"`, decryption capabilities are explicitely
   *     disabled. If encrypted content needs to be decrypted, the accompanying
   *     error `value` describes the reason why decryption is not enabled.
   *
   *   - If set to `"enabled"`, decryption capabilities are available, and
   *     `value` points to the corresponding `ContentDecryptor`.
   */
  private _decryptionCapabilities:
    | {
        status: "uninitialized";
        value: null;
      }
    | {
        status: "disabled";
        value: EncryptedMediaError;
      }
    | {
        status: "enabled";
        value: ContentDecryptor;
      };

  /**
   * Create a new `MediaSourceContentInitializer`, associated to the given
   * settings.
   * @param {Object} settings
   */
  constructor(settings: IInitializeArguments) {
    super();
    this._initSettings = settings;
    this._initCanceller = new TaskCanceller();
    this._manifest = null;
    this._decryptionCapabilities = { status: "uninitialized", value: null };
    const urls = settings.url === undefined ? undefined : [settings.url];
    this._cmcdDataBuilder =
      settings.cmcd === undefined ? null : new CmcdDataBuilder(settings.cmcd);
    this._manifestFetcher = new ManifestFetcher(urls, settings.transport, {
      ...settings.manifestRequestSettings,
      lowLatencyMode: settings.lowLatencyMode,
      cmcdDataBuilder: this._cmcdDataBuilder,
    });
  }

  /**
   * Perform non-destructive preparation steps, to prepare a future content.
   * For now, this mainly mean loading the Manifest document.
   */
  public prepare(): void {
    if (this._manifest !== null) {
      return;
    }
    this._manifest = SyncOrAsync.createAsync(
      createCancellablePromise(this._initCanceller.signal, (res, rej) => {
        this._manifestFetcher.addEventListener("warning", (err: IPlayerError) =>
          this.trigger("warning", err),
        );
        this._manifestFetcher.addEventListener("error", (err: unknown) => {
          this.trigger("error", err);
          rej(err);
        });
        this._manifestFetcher.addEventListener("manifestReady", (manifest) => {
          res(manifest);
        });
      }),
    );
    this._manifestFetcher.start();
    this._initCanceller.signal.register(() => {
      this._manifestFetcher.dispose();
    });
  }

  /**
   * @param {HTMLMediaElement} mediaElement
   * @param {Object} playbackObserver
   */
  public start(
    mediaElement: IMediaElement,
    playbackObserver: IMediaElementPlaybackObserver,
  ): void {
    this.prepare(); // Load Manifest if not already done

    /** Translate errors coming from the media element into RxPlayer errors. */
    listenToMediaError(
      mediaElement,
      (error: MediaError) => this._onFatalError(error),
      this._initCanceller.signal,
    );

    this._setupInitialMediaSourceAndDecryption(mediaElement)
      .then((initResult) =>
        this._onInitialMediaSourceReady(
          mediaElement,
          initResult.mediaSource,
          playbackObserver,
          initResult.drmSystemId,
          initResult.unlinkMediaSource,
        ),
      )
      .catch((err) => {
        this._onFatalError(err);
      });
  }

  /**
   * Update URL of the Manifest.
   * @param {Array.<string>|undefined} urls - URLs to reach that Manifest from
   * the most prioritized URL to the least prioritized URL.
   * @param {boolean} refreshNow - If `true` the resource in question (e.g.
   * DASH's MPD) will be refreshed immediately.
   */
  public updateContentUrls(urls: string[] | undefined, refreshNow: boolean): void {
    this._manifestFetcher.updateContentUrls(urls, refreshNow);
  }

  /**
   * Stop content and free all resources linked to this
   * `MediaSourceContentInitializer`.
   */
  public dispose(): void {
    this._initCanceller.cancel();
  }

  /**
   * Callback called when an error interrupting playback arised.
   * @param {*} err
   */
  private _onFatalError(err: unknown) {
    if (this._initCanceller.isUsed()) {
      return;
    }
    this._initCanceller.cancel();
    this.trigger("error", err);
  }

  /**
   * Initialize decryption mechanisms if needed and begin creating and relying
   * on the initial `MediaSourceInterface` for this content.
   * @param {HTMLMediaElement|null} mediaElement
   * @returns {Promise.<Object>}
   */
  private _setupInitialMediaSourceAndDecryption(mediaElement: IMediaElement): Promise<{
    mediaSource: MainMediaSourceInterface;
    drmSystemId: string | undefined;
    unlinkMediaSource: TaskCanceller;
  }> {
    const initCanceller = this._initCanceller;
    return createCancellablePromise(initCanceller.signal, (resolve) => {
      const { keySystems } = this._initSettings;

      /** Initialize decryption capabilities. */
      const { statusRef: drmInitRef, contentDecryptor } = initializeContentDecryption(
        mediaElement,
        keySystems,
        {
          onWarning: (err: IPlayerError) => this.trigger("warning", err),
          onError: (err: Error) => this._onFatalError(err),
          onBlackListProtectionData: (val) => {
            // Ugly IIFE workaround to allow async event listener
            (async () => {
              if (this._manifest === null) {
                return;
              }
              const manifest =
                this._manifest.syncValue ?? (await this._manifest.getValueAsAsync());
              blackListProtectionDataOnManifest(manifest, val);
            })().catch(noop);
          },
          onKeyIdsCompatibilityUpdate: (updates) => {
            // Ugly IIFE workaround to allow async event listener
            (async () => {
              if (this._manifest === null) {
                return;
              }
              const manifest =
                this._manifest.syncValue ?? (await this._manifest.getValueAsAsync());
              updateKeyIdsDecipherabilityOnManifest(
                manifest,
                updates.whitelistedKeyIds,
                updates.blacklistedKeyIds,
                updates.delistedKeyIds,
              );
            })().catch(noop);
          },

          onCodecSupportUpdate: () => {
            const syncManifest = this._manifest?.syncValue;
            if (isNullOrUndefined(syncManifest)) {
              // The Manifest is not yet fetched, but we will be able to check
              // the codecs once it is the case
              this._manifest?.getValueAsAsync().then((loadedManifest) => {
                if (this._initCanceller.isUsed()) {
                  return;
                }
                this._refreshManifestCodecSupport(loadedManifest);
              }, noop);
            } else {
              this._refreshManifestCodecSupport(syncManifest);
            }
          },
        },
        initCanceller.signal,
      );

      if (contentDecryptor.enabled) {
        this._decryptionCapabilities = {
          status: "enabled",
          value: contentDecryptor.value,
        };
      } else {
        this._decryptionCapabilities = {
          status: "disabled",
          value: contentDecryptor.value,
        };
      }

      drmInitRef.onUpdate(
        (drmStatus, stopListeningToDrmUpdates) => {
          if (drmStatus.initializationState.type === "uninitialized") {
            return;
          }
          stopListeningToDrmUpdates();

          const mediaSourceCanceller = new TaskCanceller();
          mediaSourceCanceller.linkToSignal(initCanceller.signal);
          createMediaSource(mediaElement, mediaSourceCanceller.signal)
            .then((mediaSource) => {
              const lastDrmStatus = drmInitRef.getValue();
              if (lastDrmStatus.initializationState.type === "awaiting-media-link") {
                lastDrmStatus.initializationState.value.isMediaLinked.setValue(true);
                drmInitRef.onUpdate(
                  (newDrmStatus, stopListeningToDrmUpdatesAgain) => {
                    if (newDrmStatus.initializationState.type === "initialized") {
                      stopListeningToDrmUpdatesAgain();
                      resolve({
                        mediaSource,
                        drmSystemId: newDrmStatus.drmSystemId,
                        unlinkMediaSource: mediaSourceCanceller,
                      });
                      return;
                    }
                  },
                  { emitCurrentValue: true, clearSignal: initCanceller.signal },
                );
              } else if (drmStatus.initializationState.type === "initialized") {
                resolve({
                  mediaSource,
                  drmSystemId: drmStatus.drmSystemId,
                  unlinkMediaSource: mediaSourceCanceller,
                });
                return;
              }
            })
            .catch((err) => {
              if (mediaSourceCanceller.isUsed()) {
                return;
              }
              this._onFatalError(err);
            });
        },
        { emitCurrentValue: true, clearSignal: initCanceller.signal },
      );
    });
  }

  private async _onInitialMediaSourceReady(
    mediaElement: IMediaElement,
    initialMediaSource: MainMediaSourceInterface,
    playbackObserver: IMediaElementPlaybackObserver,
    drmSystemId: string | undefined,
    initialMediaSourceCanceller: TaskCanceller,
  ): Promise<void> {
    const {
      adaptiveOptions,
      autoPlay,
      bufferOptions,
      lowLatencyMode,
      segmentRequestOptions,
      speed,
      startAt,
      textTrackOptions,
      transport,
    } = this._initSettings;
    const initCanceller = this._initCanceller;
    assert(this._manifest !== null);
    let manifest: IManifest;
    try {
      manifest = this._manifest.syncValue ?? (await this._manifest.getValueAsAsync());
    } catch (_e) {
      return; // The error should already have been processed through an event listener
    }

    manifest.addEventListener(
      "manifestUpdate",
      (updates) => {
        this.trigger("manifestUpdate", updates);
        this._refreshManifestCodecSupport(manifest);
      },
      initCanceller.signal,
    );

    manifest.addEventListener(
      "decipherabilityUpdate",
      (elts) => {
        this.trigger("decipherabilityUpdate", elts);
      },
      initCanceller.signal,
    );

    manifest.addEventListener(
      "supportUpdate",
      () => {
        this.trigger("codecSupportUpdate", null);
      },
      initCanceller.signal,
    );

    log.debug("Init: Calculating initial time");
    const initialTime = getInitialTime(manifest, lowLatencyMode, startAt);
    log.debug("Init: Initial time calculated:", initialTime);

    /** Choose the right "Representation" for a given "Adaptation". */
    const representationEstimator = AdaptiveRepresentationSelector(adaptiveOptions);
    const subBufferOptions = objectAssign(
      { textTrackOptions, drmSystemId },
      bufferOptions,
    );

    const cdnPrioritizer = new CdnPrioritizer(initCanceller.signal);
    const segmentQueueCreator = new SegmentQueueCreator(
      transport,
      cdnPrioritizer,
      this._cmcdDataBuilder,
      segmentRequestOptions,
    );

    this._refreshManifestCodecSupport(manifest);
    this.trigger("manifestReady", manifest);
    if (initCanceller.isUsed()) {
      return;
    }

    // handle initial load and reloads
    this._setupContentWithNewMediaSource(
      {
        mediaElement,
        playbackObserver,
        mediaSource: initialMediaSource,
        initialTime,
        autoPlay,
        manifest,
        representationEstimator,
        cdnPrioritizer,
        segmentQueueCreator,
        speed,
        bufferOptions: subBufferOptions,
      },
      initialMediaSourceCanceller,
    );
  }

  /**
   * Load the content defined by the Manifest in the mediaSource given at the
   * given position and playing status.
   * This function recursively re-call itself when a MediaSource reload is
   * wanted.
   * @param {Object} args
   * @param {Object} currentCanceller
   */
  private _setupContentWithNewMediaSource(
    args: IBufferingMediaSettings,
    currentCanceller: TaskCanceller,
  ): void {
    this._startLoadingContentOnMediaSource(
      args,
      this._createReloadMediaSourceCallback(args, currentCanceller),
      currentCanceller.signal,
    );
  }

  /**
   * Create `IReloadMediaSourceCallback` allowing to handle reload orders.
   * @param {Object} args
   * @param {Object} currentCanceller
   */
  private _createReloadMediaSourceCallback(
    args: IBufferingMediaSettings,
    currentCanceller: TaskCanceller,
  ): IReloadMediaSourceCallback {
    const initCanceller = this._initCanceller;
    return (reloadOrder: { position: number; autoPlay: boolean }): void => {
      currentCanceller.cancel();
      if (initCanceller.isUsed()) {
        return;
      }
      this.trigger("reloadingMediaSource", reloadOrder);
      if (initCanceller.isUsed()) {
        return;
      }

      const newCanceller = new TaskCanceller();
      newCanceller.linkToSignal(initCanceller.signal);
      createMediaSource(args.mediaElement, newCanceller.signal)
        .then((newMediaSource) => {
          this._setupContentWithNewMediaSource(
            {
              ...args,
              mediaSource: newMediaSource,
              initialTime: reloadOrder.position,
              autoPlay: reloadOrder.autoPlay,
            },
            newCanceller,
          );
        })
        .catch((err) => {
          if (newCanceller.isUsed()) {
            return;
          }
          this._onFatalError(err);
        });
    };
  }

  /**
   * Buffer the content on the given MediaSource.
   * @param {Object} args
   * @param {function} onReloadOrder
   * @param {Object} cancelSignal
   */
  private _startLoadingContentOnMediaSource(
    args: IBufferingMediaSettings,
    onReloadOrder: IReloadMediaSourceCallback,
    cancelSignal: CancellationSignal,
  ): void {
    const {
      autoPlay,
      bufferOptions,
      initialTime,
      manifest,
      mediaElement,
      mediaSource,
      playbackObserver,
      representationEstimator,
      cdnPrioritizer,
      segmentQueueCreator,
      speed,
    } = args;
    const { transport } = this._initSettings;

    const initialPeriod =
      manifest.getPeriodForTime(initialTime) ?? manifest.getNextPeriod(initialTime);
    if (initialPeriod === undefined) {
      const error = new MediaError(
        "MEDIA_STARTING_TIME_NOT_FOUND",
        "Wanted starting time not found in the Manifest.",
      );
      return this._onFatalError(error);
    }

    let textDisplayerInterface: ITextDisplayerInterface | null = null;
    const textDisplayer = createTextDisplayer(
      mediaElement,
      this._initSettings.textTrackOptions,
    );
    if (textDisplayer !== null) {
      const sender = new MainThreadTextDisplayerInterface(textDisplayer);
      textDisplayerInterface = sender;
      cancelSignal.register(() => {
        sender.stop();
        textDisplayer?.stop();
      });
    }

    /** Interface to create media buffers. */
    const segmentSinksStore = new SegmentSinksStore(
      mediaSource,
      mediaElement.nodeName === "VIDEO",
      textDisplayerInterface,
    );

    cancelSignal.register(() => {
      segmentSinksStore.disposeAll();
    });

    const { autoPlayResult, initialPlayPerformed } = performInitialSeekAndPlay(
      {
        mediaElement,
        playbackObserver,
        startTime: initialTime,
        mustAutoPlay: autoPlay,
        onWarning: (err) => {
          this.trigger("warning", err);
        },
        isDirectfile: false,
      },
      cancelSignal,
    );

    if (cancelSignal.isCancelled()) {
      return;
    }

    initialPlayPerformed.onUpdate(
      (isPerformed, stopListening) => {
        if (isPerformed) {
          stopListening();
          const streamEventsEmitter = new StreamEventsEmitter(manifest, playbackObserver);
          manifest.addEventListener(
            "manifestUpdate",
            () => {
              streamEventsEmitter.onManifestUpdate(manifest);
            },
            cancelSignal,
          );
          streamEventsEmitter.addEventListener(
            "event",
            (payload) => {
              this.trigger("streamEvent", payload);
            },
            cancelSignal,
          );
          streamEventsEmitter.addEventListener(
            "eventSkip",
            (payload) => {
              this.trigger("streamEventSkip", payload);
            },
            cancelSignal,
          );
          streamEventsEmitter.start();
          cancelSignal.register(() => {
            streamEventsEmitter.stop();
          });
        }
      },
      { clearSignal: cancelSignal, emitCurrentValue: true },
    );

    const coreObserver = createCorePlaybackObserver(
      playbackObserver,
      {
        autoPlay,
        manifest,
        mediaSource,
        textDisplayer,
        initialPlayPerformed,
        speed,
      },
      cancelSignal,
    );

    this._cmcdDataBuilder?.startMonitoringPlayback(coreObserver);
    cancelSignal.register(() => {
      this._cmcdDataBuilder?.stopMonitoringPlayback();
    });

    const rebufferingController = this._createRebufferingController(
      playbackObserver,
      manifest,
      speed,
      cancelSignal,
    );
    const freezeResolver = new FreezeResolver(segmentSinksStore);

    if (mayMediaElementFailOnUndecipherableData) {
      // On some devices, just reload immediately when data become undecipherable
      manifest.addEventListener(
        "decipherabilityUpdate",
        (elts) => {
          if (elts.some((e) => e.representation.decipherable !== true)) {
            reloadMediaSource(0, undefined, undefined);
          }
        },
        cancelSignal,
      );
    }

    coreObserver.listen(
      (observation) => {
        synchronizeSegmentSinksOnObservation(observation, segmentSinksStore);
        const freezeResolution = freezeResolver.onNewObservation(observation);
        if (freezeResolution === null) {
          return;
        }

        // TODO: The following method looks generic, we may be able to factorize
        // it with other reload handlers after some work.
        const triggerReload = () => {
          const lastObservation = playbackObserver.getReference().getValue();
          const position = lastObservation.position.isAwaitingFuturePosition()
            ? lastObservation.position.getWanted()
            : (coreObserver.getCurrentTime() ?? lastObservation.position.getPolled());
          const autoplay = initialPlayPerformed.getValue()
            ? !playbackObserver.getIsPaused()
            : autoPlay;
          onReloadOrder({ position, autoPlay: autoplay });
        };

        handleFreezeResolution(freezeResolution, {
          enableRepresentationAvoidance: this._initSettings.enableRepresentationAvoidance,
          manifest,
          triggerReload,
          playbackObserver,
        });
      },
      { clearSignal: cancelSignal },
    );

    const contentTimeBoundariesObserver = createContentTimeBoundariesObserver(
      manifest,
      mediaSource,
      coreObserver,
      segmentSinksStore,
      {
        onWarning: (err: IPlayerError) => this.trigger("warning", err),
        onPeriodChanged: (period: IPeriodMetadata) =>
          this.trigger("activePeriodChanged", { period }),
      },
      cancelSignal,
    );

    /**
     * Emit a "loaded" events once the initial play has been performed and the
     * media can begin playback.
     * Also emits warning events if issues arise when doing so.
     */
    autoPlayResult
      .then(() => {
        getLoadedReference(playbackObserver, false, cancelSignal).onUpdate(
          (isLoaded, stopListening) => {
            if (isLoaded) {
              stopListening();
              this.trigger("loaded", {
                getSegmentSinkMetrics: async () => {
                  return new Promise((resolve) =>
                    resolve(segmentSinksStore.getSegmentSinksMetrics()),
                  );
                },
                getThumbnailData: async (
                  periodId: string,
                  thumbnailTrackId: string,
                  time: number,
                ): Promise<IThumbnailResponse> => {
                  const fetchThumbnails = createThumbnailFetcher(
                    transport.thumbnails,
                    cdnPrioritizer,
                  );
                  return getThumbnailData(
                    fetchThumbnails,
                    manifest,
                    periodId,
                    thumbnailTrackId,
                    time,
                  );
                },
              });
            }
          },
          { emitCurrentValue: true, clearSignal: cancelSignal },
        );
      })
      .catch((err) => {
        if (cancelSignal.isCancelled()) {
          return; // Current loading cancelled, no need to trigger the error
        }
        this._onFatalError(err);
      });

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    StreamOrchestrator(
      { manifest, initialPeriod },
      coreObserver,
      representationEstimator,
      segmentSinksStore,
      segmentQueueCreator,
      bufferOptions,
      handleStreamOrchestratorCallbacks(),
      cancelSignal,
    );

    /**
     * Returns Object handling the callbacks from a `StreamOrchestrator`, which
     * are basically how it communicates about events.
     * @returns {Object}
     */
    function handleStreamOrchestratorCallbacks(): IStreamOrchestratorCallbacks {
      return {
        needsBufferFlush: (payload?: INeedsBufferFlushPayload) => {
          let wantedSeekingTime: number;
          const lastObservation = playbackObserver.getReference().getValue();
          const currentTime = lastObservation.position.isAwaitingFuturePosition()
            ? lastObservation.position.getWanted()
            : mediaElement.currentTime;
          const relativeResumingPosition = payload?.relativeResumingPosition ?? 0;
          const canBeApproximateSeek = Boolean(payload?.relativePosHasBeenDefaulted);

          if (relativeResumingPosition === 0 && canBeApproximateSeek) {
            // in case relativeResumingPosition is 0, we still perform
            // a tiny seek to be sure that the browser will correclty reload the video.
            wantedSeekingTime = currentTime + 0.001;
          } else {
            wantedSeekingTime = currentTime + relativeResumingPosition;
          }
          playbackObserver.setCurrentTime(wantedSeekingTime);

          // Seek again once data begins to be buffered.
          // This is sadly necessary on some browsers to avoid decoding
          // issues after a flush.
          //
          // NOTE: there's in theory a potential race condition in the following
          // logic as the callback could be called when media data is still
          // being removed by the browser - which is an asynchronous process.
          // The following condition checking for buffered data could thus lead
          // to a false positive where we're actually checking previous data.
          // For now, such scenario is avoided by setting the
          // `includeLastObservation` option to `false` and calling
          // `needsBufferFlush` once MSE media removal operations have been
          // explicitely validated by the browser, but that's a complex and easy
          // to break system.
          playbackObserver.listen(
            (obs, stopListening) => {
              if (
                // Data is buffered around the current position
                obs.currentRange !== null ||
                // Or, for whatever reason, we have no buffer but we're already advancing
                obs.position.getPolled() > wantedSeekingTime + 0.1
              ) {
                stopListening();
                playbackObserver.setCurrentTime(obs.position.getWanted() + 0.001);
              }
            },
            { includeLastObservation: false, clearSignal: cancelSignal },
          );
        },

        streamStatusUpdate(value) {
          // Announce discontinuities if found
          const { period, bufferType, imminentDiscontinuity, position } = value;
          rebufferingController.updateDiscontinuityInfo({
            period,
            bufferType,
            discontinuity: imminentDiscontinuity,
            position,
          });
          if (cancelSignal.isCancelled()) {
            return; // Previous call has stopped streams due to a side-effect
          }

          // If the status for the last Period indicates that segments are all loaded
          // or on the contrary that the loading resumed, announce it to the
          // ContentTimeBoundariesObserver.
          if (
            manifest.isLastPeriodKnown &&
            value.period.id === manifest.periods[manifest.periods.length - 1].id
          ) {
            const hasFinishedLoadingLastPeriod =
              value.hasFinishedLoading || value.isEmptyStream;
            if (hasFinishedLoadingLastPeriod) {
              contentTimeBoundariesObserver.onLastSegmentFinishedLoading(
                value.bufferType,
              );
            } else {
              contentTimeBoundariesObserver.onLastSegmentLoadingResume(value.bufferType);
            }
          }
        },

        needsManifestRefresh: () =>
          self._manifestFetcher.scheduleManualRefresh({
            enablePartialRefresh: true,
            canUseUnsafeMode: true,
          }),

        manifestMightBeOufOfSync: () => {
          const { OUT_OF_SYNC_MANIFEST_REFRESH_DELAY } = config.getCurrent();
          self._manifestFetcher.scheduleManualRefresh({
            enablePartialRefresh: false,
            canUseUnsafeMode: false,
            delay: OUT_OF_SYNC_MANIFEST_REFRESH_DELAY,
          });
        },

        lockedStream: (value) =>
          rebufferingController.onLockedStream(value.bufferType, value.period),

        adaptationChange: (value) => {
          self.trigger("adaptationChange", value);
          if (cancelSignal.isCancelled()) {
            return; // Previous call has stopped streams due to a side-effect
          }
          contentTimeBoundariesObserver.onAdaptationChange(
            value.type,
            value.period,
            value.adaptation,
          );
        },

        representationChange: (value) => {
          self.trigger("representationChange", value);
          if (cancelSignal.isCancelled()) {
            return; // Previous call has stopped streams due to a side-effect
          }
          contentTimeBoundariesObserver.onRepresentationChange(value.type, value.period);
        },

        inbandEvent: (value) => self.trigger("inbandEvents", value),

        warning: (value) => self.trigger("warning", value),

        periodStreamReady: (value) => self.trigger("periodStreamReady", value),

        periodStreamCleared: (value) => {
          contentTimeBoundariesObserver.onPeriodCleared(value.type, value.period);
          if (cancelSignal.isCancelled()) {
            return; // Previous call has stopped streams due to a side-effect
          }
          self.trigger("periodStreamCleared", {
            type: value.type,
            periodId: value.period.id,
          });
        },

        bitrateEstimateChange: (value) => {
          self._cmcdDataBuilder?.updateThroughput(value.type, value.bitrate);
          self.trigger("bitrateEstimateChange", value);
        },

        needsMediaSourceReload: (payload) => {
          reloadMediaSource(
            payload.timeOffset,
            payload.minimumPosition,
            payload.maximumPosition,
          );
        },

        needsDecipherabilityFlush() {
          const keySystem = getKeySystemConfiguration(mediaElement);
          if (shouldReloadMediaSourceOnDecipherabilityUpdate(keySystem?.[0])) {
            const lastObservation = coreObserver.getReference().getValue();
            const position = lastObservation.position.isAwaitingFuturePosition()
              ? lastObservation.position.getWanted()
              : (coreObserver.getCurrentTime() ?? lastObservation.position.getPolled());
            const isPaused =
              lastObservation.paused.pending ??
              coreObserver.getIsPaused() ??
              lastObservation.paused.last;
            onReloadOrder({ position, autoPlay: !isPaused });
          } else {
            const lastObservation = coreObserver.getReference().getValue();
            const position = lastObservation.position.isAwaitingFuturePosition()
              ? lastObservation.position.getWanted()
              : (coreObserver.getCurrentTime() ?? lastObservation.position.getPolled());
            // simple seek close to the current position
            // to flush the buffers
            if (position + 0.001 < lastObservation.duration) {
              playbackObserver.setCurrentTime(mediaElement.currentTime + 0.001);
            } else {
              playbackObserver.setCurrentTime(position);
            }
          }
        },

        encryptionDataEncountered: (value) => {
          if (self._decryptionCapabilities.status === "disabled") {
            self._onFatalError(self._decryptionCapabilities.value);
            return;
          } else if (self._decryptionCapabilities.status === "uninitialized") {
            // Should never happen
            log.error(
              "Init: received encryption data without known decryption capabilities",
            );
            return;
          }
          for (const protectionData of value) {
            self._decryptionCapabilities.value.onInitializationData(protectionData);
            if (cancelSignal.isCancelled()) {
              return; // Previous call has stopped streams due to a side-effect
            }
          }
        },

        error: (err) => self._onFatalError(err),
      };
    }

    /**
     * Callback allowing to reload the current content.
     * @param {number} deltaPosition - Position you want to seek to after
     * reloading, as a delta in seconds from the last polled playing position.
     * @param {number|undefined} minimumPosition - If set, minimum time bound
     * in seconds after `deltaPosition` has been applied.
     * @param {number|undefined} maximumPosition - If set, minimum time bound
     * in seconds after `deltaPosition` has been applied.
     */
    function reloadMediaSource(
      deltaPosition: number,
      minimumPosition: number | undefined,
      maximumPosition: number | undefined,
    ): void {
      const lastObservation = coreObserver.getReference().getValue();
      const currentPosition = lastObservation.position.isAwaitingFuturePosition()
        ? lastObservation.position.getWanted()
        : (coreObserver.getCurrentTime() ?? lastObservation.position.getPolled());
      const isPaused =
        lastObservation.paused.pending ??
        coreObserver.getIsPaused() ??
        lastObservation.paused.last;
      let position = currentPosition + deltaPosition;
      if (minimumPosition !== undefined) {
        position = Math.max(minimumPosition, position);
      }
      if (maximumPosition !== undefined) {
        position = Math.min(maximumPosition, position);
      }
      onReloadOrder({ position, autoPlay: !isPaused });
    }
  }

  /**
   * Creates a `RebufferingController`, a class trying to avoid various stalling
   * situations (such as rebuffering periods), and returns it.
   *
   * Various methods from that class need then to be called at various events
   * (see `RebufferingController` definition).
   *
   * This function also handles the `RebufferingController`'s events:
   *   - emit "stalled" events when stalling situations cannot be prevented,
   *   - emit "unstalled" events when we could get out of one,
   *   - emit "warning" on various rebuffering-related minor issues
   *     like discontinuity skipping.
   * @param {Object} playbackObserver
   * @param {Object} manifest
   * @param {Object} speed
   * @param {Object} cancelSignal
   * @returns {Object}
   */
  private _createRebufferingController(
    playbackObserver: IMediaElementPlaybackObserver,
    manifest: IManifest,
    speed: IReadOnlySharedReference<number>,
    cancelSignal: CancellationSignal,
  ): RebufferingController {
    const rebufferingController = new RebufferingController(
      playbackObserver,
      manifest,
      speed,
    );
    // Bubble-up events
    rebufferingController.addEventListener("stalled", (evt) =>
      this.trigger("stalled", evt),
    );
    rebufferingController.addEventListener("unstalled", () =>
      this.trigger("unstalled", null),
    );
    rebufferingController.addEventListener("warning", (err) =>
      this.trigger("warning", err),
    );
    cancelSignal.register(() => rebufferingController.destroy());
    rebufferingController.start();
    return rebufferingController;
  }

  /**
   * Evaluates a list of codecs to determine their support status.
   *
   * @param {Array} codecsToCheck - The list of codecs to check.
   * @returns {Array} - The list of evaluated codecs with their support status updated.
   */
  private getCodecsSupportInfo(
    codecsToCheck: Array<{ mimeType: string; codec: string }>,
  ): ICodecSupportInfo[] {
    const codecsSupportInfo: ICodecSupportInfo[] = codecsToCheck.map((codecToCheck) => {
      const inputCodec = `${codecToCheck.mimeType};codecs="${codecToCheck.codec}"`;
      const isSupported = isCodecSupported(inputCodec);
      if (!isSupported) {
        return {
          mimeType: codecToCheck.mimeType,
          codec: codecToCheck.codec,
          supported: false,
          supportedIfEncrypted: false,
        };
      }
      /**
       * `true` if the codec is supported when encrypted, `false` if it is not
       * supported, or `undefined` if we cannot obtain that information.
       */
      let supportedIfEncrypted: boolean | undefined;
      if (this._decryptionCapabilities.status === "uninitialized") {
        supportedIfEncrypted = undefined;
      } else if (this._decryptionCapabilities.status === "disabled") {
        // It's ambiguous here, but let's say that no ContentDecryptor means that
        // the codec is supported by it.
        supportedIfEncrypted = true;
      } else {
        const contentDecryptor = this._decryptionCapabilities.value;
        if (contentDecryptor.getState() !== ContentDecryptorState.Initializing) {
          // No information is available regarding the support status.
          // Defaulting to assume the codec is supported.
          supportedIfEncrypted =
            contentDecryptor.isCodecSupported(
              codecToCheck.mimeType,
              codecToCheck.codec,
            ) ?? true;
        }
      }
      return {
        mimeType: codecToCheck.mimeType,
        codec: codecToCheck.codec,
        supported: isSupported,
        supportedIfEncrypted,
      };
    });
    return codecsSupportInfo;
  }

  /**
   * Update the support status of all Representations in the Manifest.
   *
   * To call anytime either the Manifest is linked to new codecs or new means
   * to test for codec support are available.
   * @param {Object} manifest
   */
  private _refreshManifestCodecSupport(manifest: IManifest): void {
    const codecsToTest = manifest.getCodecsWithUnknownSupport();
    const codecsSupportInfo = this.getCodecsSupportInfo(codecsToTest);
    if (codecsSupportInfo.length > 0) {
      try {
        manifest.updateCodecSupport(codecsSupportInfo);
      } catch (err) {
        this._onFatalError(err);
      }
    }
  }
}

function createTextDisplayer(
  mediaElement: IMediaElement,
  textTrackOptions: ITextDisplayerOptions,
): ITextDisplayer | null {
  if (textTrackOptions.textTrackMode === "html" && features.htmlTextDisplayer !== null) {
    return new features.htmlTextDisplayer(
      mediaElement,
      textTrackOptions.textTrackElement,
    );
  } else if (features.nativeTextDisplayer !== null) {
    return new features.nativeTextDisplayer(mediaElement);
  }
  return null;
}

/** Arguments to give to the `InitializeOnMediaSource` function. */
export interface IInitializeArguments {
  /** Options concerning the ABR logic. */
  adaptiveOptions: IAdaptiveRepresentationSelectorArguments;
  /** `true` if we should play when loaded. */
  autoPlay: boolean;
  /** Options concerning the media buffers. */
  bufferOptions: {
    /** Buffer "goal" at which we stop downloading new segments. */
    wantedBufferAhead: IReadOnlySharedReference<number>;
    /** Buffer maximum size in kiloBytes at which we stop downloading */
    maxVideoBufferSize: IReadOnlySharedReference<number>;
    /** Max buffer size after the current position, in seconds (we GC further up). */
    maxBufferAhead: IReadOnlySharedReference<number>;
    /** Max buffer size before the current position, in seconds (we GC further down). */
    maxBufferBehind: IReadOnlySharedReference<number>;
    /**
     * Enable/Disable fastSwitching: allow to replace lower-quality segments by
     * higher-quality ones to have a faster transition.
     */
    enableFastSwitching: boolean;
    /** Behavior when a new video and/or audio codec is encountered. */
    onCodecSwitch: "continue" | "reload";
  };
  /**
   * When set to an object, enable "Common Media Client Data", or "CMCD".
   */
  cmcd?: ICmcdOptions | undefined;
  /**
   * If `true`, the RxPlayer can enable its "Representation avoidance"
   * mechanism, where it avoid loading Representation that it suspect
   * have issues being decoded on the current device.
   */
  enableRepresentationAvoidance: boolean;
  /** Every encryption configuration set. */
  keySystems: IKeySystemOption[];
  /** `true` to play low-latency contents optimally. */
  lowLatencyMode: boolean;
  /** Settings linked to Manifest requests. */
  manifestRequestSettings: {
    /** Maximum number of time a request on error will be retried. */
    maxRetry: number | undefined;
    /**
     * Timeout after which request are aborted and, depending on other options,
     * retried.
     * To set to `-1` for no timeout.
     * `undefined` will lead to a default, large, timeout being used.
     */
    requestTimeout: number | undefined;
    /**
     * Connection timeout, in milliseconds, after which the request is canceled
     * if the responses headers has not being received.
     * Do not set or set to "undefined" to disable it.
     */
    connectionTimeout: number | undefined;
    /** Limit the frequency of Manifest updates. */
    minimumManifestUpdateInterval: number;
    /**
     * Potential first Manifest to rely on, allowing to skip the initial Manifest
     * request.
     */
    initialManifest: IInitialManifest | undefined;
  };
  /** Logic linked Manifest and segment loading and parsing. */
  transport: ITransportPipelines;
  /** Configuration for the segment requesting logic. */
  segmentRequestOptions: {
    lowLatencyMode: boolean;
    /**
     * Amount of time after which a request should be aborted.
     * `undefined` indicates that a default value is wanted.
     * `-1` indicates no timeout.
     */
    requestTimeout: number | undefined;
    /**
     * Amount of time, in milliseconds, after which a request that hasn't receive
     * the headers and status code should be aborted and optionnaly retried,
     * depending on the maxRetry configuration.
     */
    connectionTimeout: number | undefined;
    /** Maximum number of time a request on error will be retried. */
    maxRetry: number | undefined;
  };
  /** Emit the playback rate (speed) set by the user. */
  speed: IReadOnlySharedReference<number>;
  /** The configured starting position. */
  startAt?: IInitialTimeOptions | undefined;
  /** Configuration specific to the text track. */
  textTrackOptions: ITextDisplayerOptions;
  /** URL of the Manifest. `undefined` if unknown or not pertinent. */
  url: string | undefined;
}

/** Arguments needed when starting to buffer media on a specific MediaSource. */
interface IBufferingMediaSettings {
  /** Various stream-related options. */
  bufferOptions: IStreamOrchestratorOptions;
  /* Manifest of the content we want to play. */
  manifest: IManifest;
  /** Media Element on which the content will be played. */
  mediaElement: IMediaElement;
  /** Emit playback conditions regularly. */
  playbackObserver: IMediaElementPlaybackObserver;
  /** Estimate the right Representation. */
  representationEstimator: IRepresentationEstimator;
  /**
   * Interface allowing to prioritize CDN between one another depending on past
   * performances, content steering, etc.
   */
  cdnPrioritizer: CdnPrioritizer;
  /** Module to facilitate segment fetching. */
  segmentQueueCreator: SegmentQueueCreator;
  /** Last wanted playback rate. */
  speed: IReadOnlySharedReference<number>;
  /** `MediaSource` element on which the media will be buffered. */
  mediaSource: MainMediaSourceInterface;
  /** The initial position to seek to in media time, in seconds. */
  initialTime: number;
  /** If `true` it should automatically play once enough data is loaded. */
  autoPlay: boolean;
}

/**
 * Change the decipherability of Representations which have their key id in one
 * of the given Arrays:
 *
 *   - Those who have a key id listed in `whitelistedKeyIds` will have their
 *     decipherability updated to `true`
 *
 *   - Those who have a key id listed in `blacklistedKeyIds` will have their
 *     decipherability updated to `false`
 *
 *   - Those who have a key id listed in `delistedKeyIds` will have their
 *     decipherability updated to `undefined`.
 *
 * @param {Object} manifest
 * @param {Array.<Uint8Array>} whitelistedKeyIds
 * @param {Array.<Uint8Array>} blacklistedKeyIds
 * @param {Array.<Uint8Array>} delistedKeyIds
 */
function updateKeyIdsDecipherabilityOnManifest(
  manifest: IManifest,
  whitelistedKeyIds: Uint8Array[],
  blacklistedKeyIds: Uint8Array[],
  delistedKeyIds: Uint8Array[],
): void {
  manifest.updateRepresentationsDeciperability((ctx) => {
    const { representation } = ctx;
    if (representation.contentProtections === undefined) {
      return representation.decipherable;
    }
    const contentKIDs = representation.contentProtections.keyIds;
    if (contentKIDs !== undefined) {
      for (const elt of contentKIDs) {
        for (const blacklistedKeyId of blacklistedKeyIds) {
          if (areArraysOfNumbersEqual(blacklistedKeyId, elt)) {
            return false;
          }
        }
        for (const whitelistedKeyId of whitelistedKeyIds) {
          if (areArraysOfNumbersEqual(whitelistedKeyId, elt)) {
            return true;
          }
        }
        for (const delistedKeyId of delistedKeyIds) {
          if (areArraysOfNumbersEqual(delistedKeyId, elt)) {
            return undefined;
          }
        }
      }
    }
    return representation.decipherable;
  });
}

/**
 * Update decipherability to `false` to any Representation which is linked to
 * the given initialization data.
 * @param {Object} manifest
 * @param {Object} initData
 */
function blackListProtectionDataOnManifest(
  manifest: IManifest,
  initData: IProcessedProtectionData,
) {
  manifest.updateRepresentationsDeciperability((ctx) => {
    const rep = ctx.representation;
    if (rep.decipherable === false) {
      return false;
    }
    const segmentProtections = rep.contentProtections?.initData ?? [];
    for (const protection of segmentProtections) {
      if (initData.type === undefined || protection.type === initData.type) {
        const containedInitData = initData.values
          .getFormattedValues()
          .every((undecipherableVal) => {
            return protection.values.some((currVal) => {
              return (
                (undecipherableVal.systemId === undefined ||
                  currVal.systemId === undecipherableVal.systemId) &&
                areArraysOfNumbersEqual(currVal.data, undecipherableVal.data)
              );
            });
          });
        if (containedInitData) {
          return false;
        }
      }
    }
    return rep.decipherable;
  });
}

/**
 * Function to call when you want to "reload" the MediaSource: basically
 * restarting playback on a new MediaSource for the same content (it may
 * be for varied reasons, such as ensuring data buffers are empty, or
 * restarting after some kind of fatal error).
 * @param {Object} reloadOrder
 * @param {number} reloadOrder.position - Position in seconds at which we
 * should restart from when playback restarts.
 * @param {boolean} reloadOrder.autoPlay - If `true` we will directly play
 * once enough data is re-loaded.
 */
type IReloadMediaSourceCallback = (reloadOrder: {
  position: number;
  autoPlay: boolean;
}) => void;

/**
 * Handle accordingly an `IFreezeResolution` object.
 * @param {Object|null} freezeResolution - The `IFreezeResolution` suggested.
 * @param {Object} param - Parameters that might be needed to implement the
 * resolution.
 * @param {Object} param.manifest - The current content's Manifest object.
 * @param {Object} param.playbackObserver - Object regularly emitting playback
 * conditions.
 * @param {Function} param.triggerReload - Function to call if we need to ask
 * for a "MediaSource reload".
 * @param {Boolean} param.enableRepresentationAvoidance - If `true`, this
 * function is authorized to mark `Representation` as "to avoid" if the
 * `IFreezeResolution` object suggest it.
 */
function handleFreezeResolution(
  freezeResolution: IFreezeResolution,
  {
    playbackObserver,
    enableRepresentationAvoidance,
    manifest,
    triggerReload,
  }: {
    playbackObserver: IMediaElementPlaybackObserver;
    enableRepresentationAvoidance: boolean;
    manifest: IManifest;
    triggerReload: () => void;
  },
): void {
  switch (freezeResolution.type) {
    case "reload": {
      log.info("Init: Planning reload due to freeze");
      triggerReload();
      break;
    }
    case "flush": {
      log.info("Init: Flushing buffer due to freeze");
      const observation = playbackObserver.getReference().getValue();
      const currentTime = observation.position.isAwaitingFuturePosition()
        ? observation.position.getWanted()
        : playbackObserver.getCurrentTime();
      const relativeResumingPosition = freezeResolution.value.relativeSeek;
      const wantedSeekingTime = currentTime + relativeResumingPosition;
      playbackObserver.setCurrentTime(wantedSeekingTime);
      break;
    }
    case "avoid-representations": {
      const contents = freezeResolution.value;
      if (enableRepresentationAvoidance) {
        manifest.addRepresentationsToAvoid(contents);
      }
      triggerReload();
      break;
    }
    default:
      assertUnreachable(freezeResolution);
  }
}

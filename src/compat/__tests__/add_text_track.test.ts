import { describe, beforeEach, it, expect, vi } from "vitest";
import type { IMediaElement } from "../../compat/browser_compatibility_types";
import type IAddTextTrack from "../add_text_track";

describe("compat - addTextTrack", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should re-use text track on IE / EDGE", async () => {
    const fakeTextTrack = {
      id: "textTrack1",
      HIDDEN: "hidden",
      SHOWING: "showing",
    } as unknown as TextTrack;
    const mockAddTextTrack = vi.fn(() => null);
    const fakeMediaElement = {
      textTracks: [fakeTextTrack],
      addTextTrack: mockAddTextTrack,
    } as unknown as IMediaElement;

    vi.doMock("../browser_detection", () => ({
      isIEOrEdge: true,
    }));
    const addTextTrack = (await vi.importActual("../add_text_track"))
      .default as typeof IAddTextTrack;
    const { track, trackElement } = addTextTrack(fakeMediaElement);
    expect(trackElement).toBe(undefined);
    expect(track).toBe(fakeTextTrack);
    expect(track.mode).toBe("showing");
    expect(mockAddTextTrack).not.toHaveBeenCalled();
  });

  it("should add text track if no track on media element on IE / EDGE", async () => {
    const fakeTextTrack = {
      id: "textTrack1",
      HIDDEN: "hidden",
      SHOWING: "showing",
    } as unknown as TextTrack;
    const fakeTextTracks: TextTrack[] = [];
    const mockAddTextTrack = vi.fn(() => {
      fakeTextTracks.push(fakeTextTrack);
      return fakeTextTrack;
    });

    const fakeMediaElement = {
      textTracks: fakeTextTracks,
      addTextTrack: mockAddTextTrack,
    } as unknown as IMediaElement;

    vi.doMock("../browser_detection", () => ({
      isIEOrEdge: true,
    }));

    const addTextTrack = (await vi.importActual("../add_text_track"))
      .default as typeof IAddTextTrack;
    const { track, trackElement } = addTextTrack(fakeMediaElement);
    expect(trackElement).toBe(undefined);
    expect(track).toBe(fakeTextTrack);
    expect(fakeMediaElement.textTracks.length).toBe(1);
    expect(fakeMediaElement.textTracks[0]).toBe(fakeTextTrack);
    expect(track.mode).toBe("showing");
    expect(mockAddTextTrack).toHaveBeenCalledTimes(1);
  });

  it("should create showing trackElement and set track on mediaElement", async () => {
    vi.doMock("../browser_detection", () => ({
      isIEOrEdge: false,
    }));
    const addTextTrack = (await vi.importActual("../add_text_track"))
      .default as typeof IAddTextTrack;

    const fakeTextTrack = {
      id: "textTrack1",
      HIDDEN: "hidden",
      SHOWING: "showing",
    };
    const fakeTextTrackElement = {
      track: fakeTextTrack,
      kind: undefined,
    };

    const fakeTextTracks: TextTrack[] = [];
    const fakeChildNodes: ChildNode[] = [];

    const mockAppendChild = vi.fn((_trackElement: HTMLTrackElement) => {
      fakeChildNodes.push(_trackElement);
      fakeTextTracks.push(_trackElement.track);
    });

    const fakeMediaElement = {
      textTracks: fakeTextTracks,
      appendChild: mockAppendChild,
      childNodes: fakeChildNodes,
    } as unknown as IMediaElement;

    const spyOnCreateElement = vi
      .spyOn(document, "createElement")
      .mockImplementation(() => fakeTextTrackElement as unknown as HTMLElement);

    const { track, trackElement } = addTextTrack(fakeMediaElement);
    expect(track).toBe(fakeTextTrack);
    expect(track.mode).toBe("showing");
    expect(trackElement).toBe(fakeTextTrackElement);
    expect(fakeMediaElement.textTracks[0]).toBe(fakeTextTrack);
    expect(fakeMediaElement.childNodes[0]).toBe(fakeTextTrackElement);
    expect(spyOnCreateElement).toHaveBeenCalledTimes(1);
    expect(mockAppendChild).toHaveBeenCalledTimes(1);
    spyOnCreateElement.mockReset();
  });
});

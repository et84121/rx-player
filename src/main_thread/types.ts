import type RxPlayer from "./api";
import type { IContentProtection, IProcessedProtectionData } from "./decrypt";
import type { ITextDisplayer, ITextDisplayerData } from "./text_displayer";

export type IRxPlayer = RxPlayer;

export type {
  // Decrypt Metadata
  IContentProtection,
  IProcessedProtectionData,
  // Text Displayer Metadata
  ITextDisplayer,
  ITextDisplayerData,
};

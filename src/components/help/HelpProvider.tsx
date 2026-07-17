"use client";

import { BookOpen, CircleHelp } from "lucide-react";
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HelpTab, HelpTopicId } from "../../lib/help/content";
import { InfoPopover, type PopoverAnchor } from "./InfoPopover";
import { Tooltip } from "./Tooltip";

const FieldGuideDialog = lazy(() =>
  import("./FieldGuideDialog").then((module) => ({ default: module.FieldGuideDialog })),
);

interface HelpContextValue {
  readonly openGuide: (tab?: HelpTab) => void;
  readonly openTopic: (id: HelpTopicId, anchor: HTMLElement | PopoverAnchor) => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

const pointFor = (anchor: HTMLElement | PopoverAnchor): PopoverAnchor => {
  if (!(anchor instanceof HTMLElement)) return anchor;
  const bounds = anchor.getBoundingClientRect();
  return { x: bounds.right + 8, y: bounds.top };
};

export function HelpProvider({ children }: { readonly children: ReactNode }) {
  const [guideTab, setGuideTab] = useState<HelpTab | null>(null);
  const [popover, setPopover] = useState<{
    readonly id: HelpTopicId;
    readonly anchor: PopoverAnchor;
  } | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closePopover = useCallback(() => {
    setPopover(null);
    queueMicrotask(() => restoreFocusRef.current?.focus());
  }, []);
  const openTopic = useCallback((id: HelpTopicId, anchor: HTMLElement | PopoverAnchor) => {
    restoreFocusRef.current =
      anchor instanceof HTMLElement
        ? anchor
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setGuideTab(null);
    setPopover({ id, anchor: pointFor(anchor) });
  }, []);
  const openGuide = useCallback((tab: HelpTab = "robots") => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPopover(null);
    setGuideTab(tab);
  }, []);
  const closeGuide = useCallback(() => {
    setGuideTab(null);
    queueMicrotask(() => restoreFocusRef.current?.focus());
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, select, textarea, [contenteditable='true']")
      )
        return;
      if (event.key.toLowerCase() === "h" || event.key === "?") {
        event.preventDefault();
        openGuide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGuide]);
  return (
    <HelpContext.Provider value={{ openGuide, openTopic }}>
      {children}
      {guideTab === null ? null : (
        <Suspense
          fallback={
            <div className="help-backdrop" role="status">
              Loading Field Guide…
            </div>
          }
        >
          <FieldGuideDialog initialTab={guideTab} onClose={closeGuide} onTopic={openTopic} />
        </Suspense>
      )}
      {popover === null ? null : (
        <InfoPopover topicId={popover.id} anchor={popover.anchor} onClose={closePopover} />
      )}
    </HelpContext.Provider>
  );
}

export function useHelp(): HelpContextValue {
  const value = useContext(HelpContext);
  if (value === null) throw new Error("useHelp must be used inside HelpProvider.");
  return value;
}

export function HelpButton({
  topic,
  label,
}: {
  readonly topic: HelpTopicId;
  readonly label: string;
}) {
  const { openTopic } = useHelp();
  return (
    <Tooltip label={`About ${label}`}>
      <button
        className="help-button"
        type="button"
        aria-label={`About ${label}`}
        onClick={(event) => openTopic(topic, event.currentTarget)}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function FieldGuideButton({ tab = "robots" }: { readonly tab?: HelpTab }) {
  const { openGuide } = useHelp();
  return (
    <button type="button" className="field-guide-button" onClick={() => openGuide(tab)}>
      <BookOpen size={15} aria-hidden="true" /> Field Guide
    </button>
  );
}

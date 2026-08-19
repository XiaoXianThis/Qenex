import type { FC } from "react";
import { cn } from "@qenex/core";

type TurnStreamingCaretProps = {
  /** Keep the slot mounted; only fade the dot. */
  visible: boolean;
  className?: string;
};

/**
 * Whole-turn waiting caret. Always occupies one line of height; visibility is
 * opacity only so show/hide never changes layout.
 */
export const TurnStreamingCaret: FC<TurnStreamingCaretProps> = ({
  visible,
  className,
}) => (
  <span
    data-slot="aui_turn-streaming-caret"
    data-visible={visible ? "" : undefined}
    className={cn("aui-turn-caret", className)}
    aria-hidden={!visible}
    aria-label={visible ? "Assistant is working" : undefined}
  >
    <span className="aui-turn-caret-fade">
      <span className="aui-turn-caret-dot" aria-hidden>
        ●
      </span>
    </span>
  </span>
);

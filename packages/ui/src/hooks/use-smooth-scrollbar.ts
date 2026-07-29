import SmoothScrollbar, { ScrollbarPlugin } from "smooth-scrollbar";
import { useLayoutEffect, useRef, type RefObject } from "react";

const PROGRAMMATIC_SCROLL_DURATION_MS = 180;
const WEBKIT_WHEEL_STEP = 120;
const MOUSE_WHEEL_DISTANCE_PX = 56;

const canScrollInDirection = (
  element: HTMLElement,
  axis: "x" | "y",
  delta: number,
) => {
  if (Math.abs(delta) < 0.01) return false;

  const style = getComputedStyle(element);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (!/(auto|scroll|overlay)/.test(overflow)) return false;

  const position = axis === "y" ? element.scrollTop : element.scrollLeft;
  const viewportSize =
    axis === "y" ? element.clientHeight : element.clientWidth;
  const contentSize = axis === "y" ? element.scrollHeight : element.scrollWidth;

  if (contentSize <= viewportSize) return false;
  return delta < 0 ? position > 0 : position + viewportSize < contentSize;
};

const canNestedElementScroll = (
  target: EventTarget | null,
  viewport: HTMLElement,
  delta: { x: number; y: number },
) => {
  let element = target instanceof Element ? target : null;

  while (element && element !== viewport) {
    if (
      element instanceof HTMLElement &&
      (canScrollInDirection(element, "y", delta.y) ||
        canScrollInDirection(element, "x", delta.x))
    ) {
      return true;
    }
    element = element.parentElement;
  }

  return false;
};

class PreserveNestedScrollPlugin extends ScrollbarPlugin {
  static pluginName = "preserveNestedScroll";

  transformDelta(delta: { x: number; y: number }, event: Event) {
    if (
      canNestedElementScroll(
        event.target,
        this.scrollbar.containerEl,
        delta,
      )
    ) {
      return { x: 0, y: 0 };
    }

    if (event instanceof WheelEvent) {
      const webKitEvent = event as WheelEvent & {
        wheelDelta?: number;
        wheelDeltaY?: number;
      };
      const wheelDelta = webKitEvent.wheelDeltaY ?? webKitEvent.wheelDelta;
      const wheelSteps =
        typeof wheelDelta === "number"
          ? Math.abs(wheelDelta) / WEBKIT_WHEEL_STEP
          : 0;

      if (
        wheelSteps >= 1 &&
        Math.abs(wheelSteps - Math.round(wheelSteps)) < 0.01
      ) {
        return {
          x: delta.x,
          y:
            (-wheelDelta! / WEBKIT_WHEEL_STEP) *
            MOUSE_WHEEL_DISTANCE_PX,
        };
      }
    }

    return delta;
  }
}

SmoothScrollbar.use(PreserveNestedScrollPlugin);

type ScrollBehaviorWithInstant = ScrollBehavior | "instant";
type ScrollOptions = {
  behavior?: ScrollBehaviorWithInstant;
  left?: number;
  top?: number;
};

const installNativeScrollBridge = (
  viewport: HTMLDivElement,
  scrollbar: ReturnType<typeof SmoothScrollbar.init>,
) => {
  // smooth-scrollbar listens for native scroll events and writes the container
  // back to (0, 0). Ignore that internal reset while forwarding its virtual
  // position as a synthetic event to assistant-ui.
  let dispatchingSyntheticScroll = false;
  const propertyNames = [
    "scrollTop",
    "scrollLeft",
    "scrollHeight",
    "scrollWidth",
    "scrollTo",
    "scrollBy",
  ] as const;
  const previousDescriptors = new Map(
    propertyNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(viewport, name),
    ]),
  );

  const liveScrollHeight = () =>
    Math.max(
      scrollbar.size.content.height,
      scrollbar.contentEl.offsetHeight,
      scrollbar.contentEl.scrollHeight,
    );
  const liveScrollWidth = () =>
    Math.max(
      scrollbar.size.content.width,
      scrollbar.contentEl.offsetWidth,
      scrollbar.contentEl.scrollWidth,
    );

  const moveTo = ({
    behavior = "instant",
    left = scrollbar.scrollLeft,
    top = scrollbar.scrollTop,
  }: ScrollOptions) => {
    scrollbar.update();
    scrollbar.setMomentum(0, 0);

    if (behavior === "smooth" || behavior === "auto") {
      scrollbar.scrollTo(
        left,
        top,
        PROGRAMMATIC_SCROLL_DURATION_MS,
      );
    } else {
      scrollbar.setPosition(left, top);
    }
  };

  Object.defineProperties(viewport, {
    scrollTop: {
      configurable: true,
      get: () => scrollbar.scrollTop,
      set: (top: number) => {
        if (!dispatchingSyntheticScroll) moveTo({ top });
      },
    },
    scrollLeft: {
      configurable: true,
      get: () => scrollbar.scrollLeft,
      set: (left: number) => {
        if (!dispatchingSyntheticScroll) moveTo({ left });
      },
    },
    scrollHeight: {
      configurable: true,
      get: liveScrollHeight,
    },
    scrollWidth: {
      configurable: true,
      get: liveScrollWidth,
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value: (
        optionsOrLeft: ScrollOptions | number = {},
        top?: number,
      ) => {
        if (typeof optionsOrLeft === "number") {
          moveTo({ left: optionsOrLeft, top });
          return;
        }
        moveTo(optionsOrLeft);
      },
    },
    scrollBy: {
      configurable: true,
      writable: true,
      value: (
        optionsOrLeft: ScrollOptions | number = {},
        top?: number,
      ) => {
        if (typeof optionsOrLeft === "number") {
          moveTo({
            left: scrollbar.scrollLeft + optionsOrLeft,
            top: scrollbar.scrollTop + (top ?? 0),
          });
          return;
        }
        moveTo({
          behavior: optionsOrLeft.behavior,
          left: scrollbar.scrollLeft + (optionsOrLeft.left ?? 0),
          top: scrollbar.scrollTop + (optionsOrLeft.top ?? 0),
        });
      },
    },
  });

  return {
    dispatchScroll: () => {
      dispatchingSyntheticScroll = true;
      try {
        viewport.dispatchEvent(new Event("scroll"));
      } finally {
        dispatchingSyntheticScroll = false;
      }
    },
    restore: () => {
      for (const name of propertyNames) {
        const descriptor = previousDescriptors.get(name);
        if (descriptor) {
          Object.defineProperty(viewport, name, descriptor);
        } else {
          delete viewport[name];
        }
      }
    },
  };
};

/**
 * Adds smooth-scrollbar while preserving the native scroll API expected by
 * assistant-ui's auto-scroll and scroll-to-bottom behavior.
 */
export const useSmoothScrollbar = (
  disabled = false,
): RefObject<HTMLDivElement | null> => {
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (
      !viewport ||
      disabled ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const originalAttributes = {
      dataScrollbar: viewport.getAttribute("data-scrollbar"),
      tabIndex: viewport.getAttribute("tabindex"),
    };
    const originalStyles = {
      msTouchAction: viewport.style.getPropertyValue("-ms-touch-action"),
      outline: viewport.style.outline,
      overflow: viewport.style.overflow,
    };

    const scrollbar = SmoothScrollbar.init(viewport, {
      alwaysShowTracks: true,
      continuousScrolling: true,
      damping: 0.12,
      renderByPixels: false,
    });
    const syncViewportSize = () => {
      // A definite height keeps descendants using `min-height: 100%` sized to
      // the viewport. Overflowing messages still contribute to scrollHeight.
      const height = `${viewport.clientHeight}px`;
      if (scrollbar.contentEl.style.height !== height) {
        scrollbar.contentEl.style.height = height;
      }
      scrollbar.update();
    };
    const viewportResizeObserver = new ResizeObserver(syncViewportSize);
    viewportResizeObserver.observe(viewport);
    const contentResizeObserver = new ResizeObserver(() => {
      scrollbar.update();
    });
    for (const child of scrollbar.contentEl.children) {
      if (child instanceof HTMLElement) {
        contentResizeObserver.observe(child);
      }
    }
    syncViewportSize();

    const nativeScrollBridge = installNativeScrollBridge(
      viewport,
      scrollbar,
    );
    const dispatchNativeScroll = nativeScrollBridge.dispatchScroll;
    scrollbar.addListener(dispatchNativeScroll);

    return () => {
      viewportResizeObserver.disconnect();
      contentResizeObserver.disconnect();
      scrollbar.removeListener(dispatchNativeScroll);
      nativeScrollBridge.restore();
      scrollbar.destroy();

      if (originalAttributes.dataScrollbar === null) {
        viewport.removeAttribute("data-scrollbar");
      } else {
        viewport.setAttribute(
          "data-scrollbar",
          originalAttributes.dataScrollbar,
        );
      }
      if (originalAttributes.tabIndex === null) {
        viewport.removeAttribute("tabindex");
      } else {
        viewport.setAttribute("tabindex", originalAttributes.tabIndex);
      }

      viewport.style.overflow = originalStyles.overflow;
      viewport.style.outline = originalStyles.outline;
      viewport.style.setProperty(
        "-ms-touch-action",
        originalStyles.msTouchAction,
      );
    };
  }, [disabled]);

  return viewportRef;
};

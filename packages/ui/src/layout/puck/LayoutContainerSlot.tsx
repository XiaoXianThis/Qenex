"use client";

import { LayoutEditLabel } from "@/layout/puck/LayoutEditLabel";
import { layoutComponentHighlightClass } from "@/layout/layoutEditPanel";
import { cn, useLayoutStore } from "@qenex/core";
import type { ComponentType, FC, ReactNode } from "react";

type SlotComponent = ComponentType<{ className?: string; children?: ReactNode }>;

type LayoutContainerSlotProps = {
  label: string;
  componentType: string;
  /** Puck 实例 id，用于实例级样式挂点 */
  instanceId?: string;
  editing?: boolean;
  className: string;
  children: SlotComponent;
};

export const LayoutContainerSlot: FC<LayoutContainerSlotProps> = ({
  label,
  componentType,
  instanceId,
  editing,
  className,
  children: Children,
}) => {
  const hoveredDrawerComponentType = useLayoutStore(
    (s) => s.hoveredDrawerComponentType,
  );
  const isHighlighted = hoveredDrawerComponentType === componentType;

  if (!editing) {
    return (
      <div
        data-layout-component={componentType}
        data-layout-instance={instanceId}
        className="w-full min-w-0"
      >
        <Children className={className} />
      </div>
    );
  }

  return (
    <div
      data-layout-component={componentType}
      data-layout-instance={instanceId}
      data-layout-puck-type={componentType}
      className={cn(
        "relative w-full min-w-0",
        layoutComponentHighlightClass(isHighlighted),
      )}
    >
      <LayoutEditLabel label={label} />
      <Children className={className} />
    </div>
  );
};

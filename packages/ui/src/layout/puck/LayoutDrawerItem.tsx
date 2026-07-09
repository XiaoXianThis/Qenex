"use client";

import { layoutActions } from "@qenex/core";
import type { FC, ReactNode } from "react";

type LayoutDrawerItemProps = {
  name: string;
  children: ReactNode;
};

export const LayoutDrawerItem: FC<LayoutDrawerItemProps> = ({
  name,
  children,
}) => {
  return (
    <div
      onMouseEnter={() => layoutActions.setHoveredDrawerComponentType(name)}
      onMouseLeave={() => layoutActions.setHoveredDrawerComponentType(null)}
    >
      {children}
    </div>
  );
};

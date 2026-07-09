"use client";

import { cn } from "@qenex/core";
import type { WidthScope } from "@qenex/core";
import type { FC, ReactNode } from "react";

type WidthScopeWrapperProps = {
  scope: WidthScope;
  className?: string;
  children: ReactNode;
};

export const WidthScopeWrapper: FC<WidthScopeWrapperProps> = ({
  scope,
  className,
  children,
}) => {
  return (
    <div
      data-width-scope={scope}
      className={cn(
        scope === "viewport" && "w-full",
        scope === "content" &&
          "mx-auto w-full max-w-(--thread-max-width, 800px)",
        className,
      )}
    >
      {children}
    </div>
  );
};

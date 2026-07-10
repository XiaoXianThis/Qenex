"use client";

import type { PanelId } from "@qenex/core";
import {
  CheckSquare,
  Coins,
  type LucideIcon,
} from "lucide-react";
import type { FC } from "react";

const WIDGET_META: Record<
  Extract<PanelId, "checklist" | "tokenStats">,
  { title: string; icon: LucideIcon }
> = {
  checklist: { title: "CheckList", icon: CheckSquare },
  tokenStats: { title: "Token 统计", icon: Coins },
};

type WidgetPlaceholderProps = {
  panelId: keyof typeof WIDGET_META;
};

export const WidgetPlaceholder: FC<WidgetPlaceholderProps> = ({ panelId }) => {
  const meta = WIDGET_META[panelId];
  const Icon = meta.icon;

  return (
    <div className="border-border/60 bg-muted/20 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{meta.title}</div>
        <div className="text-muted-foreground text-xs">即将推出</div>
      </div>
    </div>
  );
};

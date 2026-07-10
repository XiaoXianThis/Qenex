"use client";

import {
  DEFAULT_AGENT_ICON,
  getAgentIconCandidates,
} from "@/config/agent-icons";
import { cn } from "@qenex/core";
import {
  useCallback,
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

type AgentIconProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt"
> & {
  agentId: string;
  remoteIcon?: string | null;
  alt?: string;
};

/**
 * Agent icon with fallback chain: bundled → remote/CDN → default.
 */
export function AgentIcon({
  agentId,
  remoteIcon,
  className,
  alt = "",
  onError,
  ...rest
}: AgentIconProps) {
  const candidates = getAgentIconCandidates(agentId, remoteIcon);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [agentId, remoteIcon]);

  const src =
    candidates[Math.min(index, candidates.length - 1)] ?? DEFAULT_AGENT_ICON;

  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement, Event>) => {
      setIndex((current) =>
        current + 1 < candidates.length ? current + 1 : current,
      );
      onError?.(event);
    },
    [candidates.length, onError],
  );

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={cn("object-contain", className)}
      onError={handleError}
    />
  );
}

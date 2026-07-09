import type { FC } from "react";

type LayoutEditLabelProps = {
  label: string;
};

export const LayoutEditLabel: FC<LayoutEditLabelProps> = ({ label }) => {
  return (
    <span
      className="pointer-events-none absolute top-0 left-0 z-10 rounded-br bg-primary/90 px-1.5 py-0.5 text-[10px] leading-none font-medium text-primary-foreground shadow-sm"
      aria-hidden
    >
      {label}
    </span>
  );
};

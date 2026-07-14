/// <reference types="vite/client" />

declare module "*.svg?react" {
  import type { ComponentProps, FunctionComponent } from "react";

  const ReactComponent: FunctionComponent<
    ComponentProps<"svg"> & {
      title?: string;
      titleId?: string;
      desc?: string;
      descId?: string;
    }
  >;

  export default ReactComponent;
}

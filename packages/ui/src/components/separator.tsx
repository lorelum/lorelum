import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { composeClassName } from "../lib/compose-class-name";

const separatorClassName =
  "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch";

function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={composeClassName<SeparatorPrimitive.State>(separatorClassName, className)}
      {...props}
    />
  );
}

export { Separator };

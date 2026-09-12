import type { ReactNode } from "react";
import { SpecularButton, type SpecularButtonProps } from "@/vendor/react-bits";
import { useCanvasEffectsEnabled } from "../motion/use-canvas-effects";

export type MotionAwareSpecularButtonProps = Omit<SpecularButtonProps, "enableFx">;

/**
 * Motion-gated SpecularButton.
 *
 * The WebGL specular edge is a pointer-driven effect, so it only makes sense
 * with a fine pointer: touch users get the identical pill (glass tint,
 * shadow, press feedback) minus the light canvas, and no per-frame render
 * loop is ever started for them.
 */
export function MotionAwareSpecularButton({
  children,
  ...props
}: MotionAwareSpecularButtonProps & { children?: ReactNode }) {
  const fxEnabled = useCanvasEffectsEnabled();

  return (
    <SpecularButton enableFx={fxEnabled} {...props}>
      {children}
    </SpecularButton>
  );
}

import type { MotionAwareSpecularButtonProps } from "../motion-aware/motion-aware-specular-button";

/**
 * Shared look for the landing's specular CTA pill (hero + closing CTA).
 * Call sites spread this and override the few per-section values
 * (tint opacity, blur, click target).
 */
export const specularCtaProps = {
  size: "lg",
  radius: 999,
  tint: "#141417",
  textColor: "#f5f5f5",
  lineColor: "#ffffff",
  baseColor: "#8b8b96",
  intensity: 1.15,
  shineSize: 12,
  shineFade: 42,
  followMouse: true,
  proximity: 280,
  className: "landing-specular-cta group",
} satisfies Partial<MotionAwareSpecularButtonProps>;

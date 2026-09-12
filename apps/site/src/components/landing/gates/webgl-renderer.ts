/**
 * Client-only WebGL renderer probe for the landing page.
 *
 * Reads the *unmasked* GL_RENDERER string (the actual driver behind the
 * browser), which reveals software rasterizers that the default RENDERER
 * query hides. Requires `WEBGL_debug_renderer_info`; when it is absent we
 * conservatively assume hardware (the extension is present in every
 * Chromium/Edge/Firefox build, so a missing extension already implies an
 * unusual embedder — assume the best rather than degrade a working setup).
 *
 * Browser-only: guards on `typeof window`. Cheap and synchronous, safe to
 * call once during mount (the probe canvas is immediately discarded).
 */

import { isSoftwareRenderer } from "./webgl-capability";

export type WebglCapability = "hardware" | "software" | "unknown";

/**
 * Read the *unmasked* GL_RENDERER string, or `null` when WebGL is unavailable
 * or the read fails. Browser-only: creates a throwaway probe canvas and
 * releases its context via WEBGL_lose_context when present.
 */
export function readWebglRendererString(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("webgl2");
    if (!gl) return null;

    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return null;
  }
}

export function detectWebglRenderer(): WebglCapability {
  const name = readWebglRendererString();
  if (name === null) return "unknown";
  return isSoftwareRenderer(name) ? "software" : "hardware";
}

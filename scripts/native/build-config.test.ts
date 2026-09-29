import { expect, test } from "bun:test";
import { resolve } from "node:path";
import buildConfig from "../../native/embedding/build-config.json";
import darwinTrusted from "../../packages/backend/src/runtime/native/embedding/darwin-arm64.json";
import linuxTrusted from "../../packages/backend/src/runtime/native/embedding/linux-x64.json";
import win32Trusted from "../../packages/backend/src/runtime/native/embedding/win32-x64.json";
import { stableSha256 } from "./cache-paths";
import { assertNativePatchDigest } from "./source-tree";

const repositoryRoot = resolve(import.meta.dir, "../..");

type Target = "darwin-arm64" | "linux-x64" | "win32-x64";

function expandedCmakeFlags(target: Target): readonly string[] {
  return buildConfig.targets[target].cmakeFlags.map((flag) =>
    flag
      .replace("@BUILD_NUMBER@", buildConfig.source.tag.slice(1))
      .replace(
        "@BUILD_COMMIT@",
        `${buildConfig.source.commit.slice(0, 8)}-lorelum.${buildConfig.patch.sha256.slice(0, 8)}`,
      ),
  );
}

/** The trusted manifests and the reviewed recipe must describe the same build inputs. */
function recipeIdentity(target: Target): string {
  return stableSha256({
    schemaVersion: buildConfig.schemaVersion,
    source: buildConfig.source,
    patchSha256: buildConfig.patch.sha256,
    cmakeFlags: expandedCmakeFlags(target),
    model: buildConfig.model,
  });
}

test("each target's recipe identity still reproduces its trusted manifest", () => {
  expect(recipeIdentity("darwin-arm64")).toBe(darwinTrusted.recipeIdentity);
  expect(recipeIdentity("linux-x64")).toBe(linuxTrusted.recipeIdentity);
  expect(recipeIdentity("win32-x64")).toBe(win32Trusted.recipeIdentity);
});

test("trusted manifests record exactly the expanded recipe flags", () => {
  expect(darwinTrusted.cmakeFlags).toEqual(expandedCmakeFlags("darwin-arm64"));
  expect(linuxTrusted.cmakeFlags).toEqual(expandedCmakeFlags("linux-x64"));
  expect(win32Trusted.cmakeFlags).toEqual(expandedCmakeFlags("win32-x64"));
});

test("x64 recipes keep the AVX2 baseline", () => {
  for (const target of ["linux-x64", "win32-x64"] as const) {
    const flags = buildConfig.targets[target].cmakeFlags;
    expect(flags).toContain("-DGGML_NATIVE=OFF");
    for (const cap of ["GGML_SSE42", "GGML_AVX", "GGML_AVX2", "GGML_BMI2", "GGML_FMA", "GGML_F16C"])
      expect(flags).toContain(`-D${cap}=ON`);
    // VNNI and AVX-512 stay off so the baseline remains Haswell-era (2013+) x86-64 CPUs.
    expect(flags.join(" ")).not.toMatch(/GGML_AVX_VNNI|GGML_AVX512/);
  }
  // The darwin-only architecture and deployment flags must not leak into Linux builds.
  for (const flag of buildConfig.targets["linux-x64"].cmakeFlags)
    expect(flag).not.toMatch(/^-DCMAKE_OSX_|^-DGGML_CPU_ARM_ARCH/);
});

test("reviewed patch file matches its pinned digest", () => {
  expect(() => assertNativePatchDigest(repositoryRoot)).not.toThrow();
});

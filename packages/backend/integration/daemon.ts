import { runBackendDaemon } from "../src/runtime/daemon";
if (process.env.LORELUM_TEST_SENTINEL !== undefined)
  throw new Error("Daemon inherited a non-allowlisted environment variable");
await runBackendDaemon({
  build: {
    buildIdentity: process.argv[2] ?? "integration-build",
    toolVersion: "integration",
    revision: null,
    dirty: null,
    buildKind: "source",
  },
});

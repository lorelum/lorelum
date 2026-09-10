import { runBackendDaemon } from "../src/runtime/daemon";
if (process.env.LORELUM_TEST_SENTINEL !== undefined)
  throw new Error("Daemon inherited a non-allowlisted environment variable");
await runBackendDaemon({ buildIdentity: "integration-build" });

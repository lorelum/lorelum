import { expect, test } from "bun:test";
import {
  consumeDaemonLaunch,
  daemonEnvironment,
  hasDaemonLaunchEnvironment,
  platformEnvironment,
} from "./launch";

test("private launch values are validated and consumed separately from user settings", () => {
  const launch = {
    runtimeDirectory: "/tmp/lorelum-runtime",
    instanceId: "12345678-1234-4234-8234-123456789012",
    port: 26186,
  };
  const environment = daemonEnvironment(launch, {
    PATH: "/bin",
    API_TOKEN: "private",
    LORELUM_BACKEND_REQUEST_TIMEOUT_MS: "10",
  });
  expect(environment.API_TOKEN).toBeUndefined();
  expect(environment.LORELUM_BACKEND_REQUEST_TIMEOUT_MS).toBeUndefined();
  expect(hasDaemonLaunchEnvironment(environment)).toBe(true);
  expect(consumeDaemonLaunch(environment)).toEqual(launch);
  expect(hasDaemonLaunchEnvironment(environment)).toBe(false);
  expect(environment.PATH).toBe("/bin");
});

test("invalid private launch is rejected", () => {
  expect(() => consumeDaemonLaunch({ LORELUM_BACKEND_DIRECTORY: "relative" })).toThrow();
  expect(platformEnvironment({ HOME: "/tmp/home", AUTH_TOKEN: "private" })).toEqual({
    HOME: "/tmp/home",
  });
});

test("platform environment keeps the required Windows values", () => {
  expect(
    platformEnvironment({
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\test",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      API_TOKEN: "private",
    }),
  ).toEqual({
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    TEMP: "C:\\Temp",
    TMP: "C:\\Temp",
    USERPROFILE: "C:\\Users\\test",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
  });
});

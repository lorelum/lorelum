import { expect, test } from "bun:test";

import {
  capInvocationNotices,
  createInvocationNotice,
  invocationNoticeBudgets,
  invocationNoticeSchema,
  invocationNoticeKinds,
  invocationNoticeReasons,
} from "./notices.js";

test("truncates budget-exceeding strings deterministically by code point", () => {
  const longSubject = "配置".repeat(100);
  const longReceived = "noisy-".repeat(40);
  const first = createInvocationNotice({
    kind: "configuration",
    subject: longSubject,
    reason: "invalid-value",
    received: longReceived,
  });
  const second = createInvocationNotice({
    kind: "configuration",
    subject: longSubject,
    reason: "invalid-value",
    received: longReceived,
  });
  expect(Array.from(first.subject).length).toBe(invocationNoticeBudgets.subjectMaxLength);
  expect(Array.from(first.received ?? "").length).toBe(invocationNoticeBudgets.receivedMaxLength);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test("drops empty optional strings and freezes the notice", () => {
  const notice = createInvocationNotice({
    kind: "configuration",
    subject: "logging.level",
    reason: "invalid-value",
    received: "",
    effective: "info",
    source: "",
  });
  expect(notice).toEqual({
    kind: "configuration",
    subject: "logging.level",
    reason: "invalid-value",
    effective: "info",
  });
  expect(Object.isFrozen(notice)).toBe(true);
});

test("rejects an empty subject", () => {
  expect(() =>
    createInvocationNotice({ kind: "configuration", subject: "", reason: "invalid-value" }),
  ).toThrow(TypeError);
});

test("constrains expected enum values to the public budget", () => {
  const values = Array.from({ length: 20 }, (_, index) => `level-${index}`);
  const notice = createInvocationNotice({
    kind: "configuration",
    subject: "logging.level",
    reason: "invalid-value",
    expected: { kind: "enum", values },
  });
  expect(notice.expected?.kind).toBe("enum");
  if (notice.expected?.kind === "enum") {
    expect(notice.expected.values.length).toBe(invocationNoticeBudgets.enumValuesMax);
    expect(notice.expected.values[0]).toBe("level-0");
  }
});

test("caps the notice list preserving producer order", () => {
  const notices = Array.from({ length: 8 }, (_, index) =>
    createInvocationNotice({
      kind: "configuration",
      subject: `setting.${index}`,
      reason: "invalid-value",
    }),
  );
  const capped = capInvocationNotices(notices);
  expect(capped.length).toBe(invocationNoticeBudgets.maxNotices);
  expect(capped[0]?.subject).toBe("setting.0");
});

test("exposes a closed schema vocabulary", () => {
  expect(invocationNoticeSchema.properties).toBeDefined();
  expect(invocationNoticeKinds).toEqual(["configuration"]);
  expect(invocationNoticeReasons).toContain("invalid-value");
});

import { useEffect, useRef, useState } from "react";
import { getStrings, type LandingStrings } from "@/shared/i18n/legacy-translations";

/**
 * A fixed-height terminal demo that replays a *real* Lorelum CLI transcript.
 *
 * The output lines are the actual protocol envelopes emitted by
 * `lore install agentic-coding` (first install, 30 Practices added) and
 * `lore get agentic-coding.verification.bind-evidence-to-artifact-state`,
 * captured from the real CLI in `packages/cli` and trimmed only for width.
 * JSON keys/strings/numbers are syntax-highlighted the way a modern
 * terminal theme would show them.
 *
 * The window is a stable block that never changes height:
 *
 *   1. the `lore install …` command is typed character by character
 *   2. result lines appear one at a time (abbreviated envelope + delta list)
 *   3. the second command (`lore get …`) is typed, then its envelope lines
 *   4. after a pause the window clears and replays from step 1
 *
 * Performance: typing writes straight to the DOM via a ref (no React
 * renders during the typewriter phase), the whole loop pauses whenever the
 * demo scrolls out of view, and only the occasional phase/line-count change
 * re-render — so it never adds main-thread work while the user scrolls.
 */

const TYPE_SPEED = 26; // ms per 2-character tick (~13ms/char effective)
const LINE_DELAY = 340; // pause between output lines
const COMMAND_PAUSE = 520; // pause after a command finishes typing
const REPLAY_DELAY = 2000; // pause after the last line before replaying

/** One immutable, pre-tokenized output line of the replayed transcript. */
interface TranscriptLine {
  /** Stable key so React can keep DOM nodes between renders. */
  key: string;
  /** Pre-rendered spans for this line (mutually exclusive variants). */
  spans: LineSpan[];
}

type LineSpan =
  | { t: "prompt" }
  | { t: "plain"; text: string }
  | { t: "key"; text: string }
  | { t: "string"; text: string }
  | { t: "number"; text: string }
  | { t: "punct"; text: string }
  | { t: "dim"; text: string };

interface DemoCommand {
  /** The command typed after the `$` prompt, without the leading `$ `. */
  readonly command: string;
  /** Output lines revealed after the command "runs". */
  readonly lines: readonly TranscriptLine[];
}

const K = (text: string): LineSpan => ({ t: "key", text });
const S = (text: string): LineSpan => ({ t: "string", text });
const N = (text: string): LineSpan => ({ t: "number", text });
const P = (text: string): LineSpan => ({ t: "punct", text });
const D = (text: string): LineSpan => ({ t: "dim", text });
const LINE = (key: string, spans: LineSpan[]): TranscriptLine => ({ key, spans });

/**
 * Build the two-command transcript from localized strings.
 *
 * The JSON content mirrors the real CLI envelopes; `t.installLines` and
 * `t.getLines` hold the language-specific pieces (labels/description text),
 * while ids, digests and numbers are the genuine captured values.
 */
function buildCommands(t: LandingStrings): readonly DemoCommand[] {
  return [
    {
      command: "lore install agentic-coding",
      lines: [
        LINE("i0", [P("{")]),
        LINE("i1", [
          D("  "),
          K('"protocolVersion"'),
          P(": "),
          N("1"),
          P(",  "),
          K('"toolVersion"'),
          P(": "),
          S('"0.0.0"'),
          P(","),
        ]),
        LINE("i2", [
          D("  "),
          K('"command"'),
          P(": "),
          S('"install"'),
          P(",  "),
          K('"ok"'),
          P(": "),
          N("true"),
          P(","),
        ]),
        LINE("i3", [D("  "), K('"registry"'), P(": "), S('"lorelum/lorelum-packs"'), P(",")]),
        LINE("i4", [D("  "), K('"pack"'), P(": "), S('"agentic-coding@0.3.0"'), P(",")]),
        LINE("i5", [
          D("  "),
          K('"generation"'),
          P(": "),
          N("1"),
          P(",  "),
          K('"idempotent"'),
          P(": "),
          N("false"),
          P(","),
        ]),
        LINE("i6", [
          D("  "),
          K('"delta"'),
          P(": { "),
          K('"added"'),
          P(": "),
          N(t.installAddedCount),
          P(" practices, "),
          K('"changed"'),
          P(": "),
          N("0"),
          P(" }"),
        ]),
        LINE("i7", [D("  "), K('"artifactDigest"'), P(": "), S('"797bf9bb…b5ef"')]),
        LINE("i8", [P("}")]),
      ],
    },
    {
      command: "lore get agentic-coding.verification.bind-evidence-to-artifact-state",
      lines: [
        LINE("g0", [
          P("{"),
          D("  "),
          K('"command"'),
          P(": "),
          S('"get"'),
          P(",  "),
          K('"ok"'),
          P(": "),
          N("true"),
          P(","),
        ]),
        LINE("g1", [
          D("  "),
          K('"id"'),
          P(": "),
          S('"…verification.bind-evidence-to-artifact-state"'),
          P(","),
        ]),
        LINE("g2", [D("  "), K('"title"'), P(": "), S(`"${t.getTitle}"`), P(",")]),
        LINE("g3", [
          D("  "),
          K('"stage"'),
          P(": "),
          S('"verification"'),
          P(",  "),
          K('"severity"'),
          P(": "),
          S('"warn"'),
          P(","),
        ]),
        LINE("g4", [D("  "), K('"applies_when"'), P(": "), S(`"${t.appliesWhen}"`), P(",")]),
        LINE("g5", [D("  "), K('"anti_patterns"'), P(": ["), S(`"${t.antiPattern}"`), P("],")]),
        LINE("g6", [
          D("  "),
          K('"sources"'),
          P(": [{ "),
          K('"packName"'),
          P(": "),
          S('"agentic-coding"'),
          P(" }]"),
        ]),
        LINE("g7", [P("}")]),
      ],
    },
  ];
}

export function TerminalDemo({ locale = "en" }: { locale?: string }) {
  const t = getStrings(locale);
  const commands = buildCommands(t);

  // phase: 'typing' | 'output' | 'paused'
  const [phase, setPhase] = useState<"typing" | "output" | "paused">("typing");
  const [commandIndex, setCommandIndex] = useState(0);
  /** Number of output lines of the current command currently visible. */
  const [lineCount, setLineCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLSpanElement>(null);

  // Pause the whole demo when it scrolls out of view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const current = commands[commandIndex]!;

  // Phase 1: type the command into the DOM directly — no React renders here.
  useEffect(() => {
    if (!visible || phase !== "typing") return;
    const el = commandRef.current;
    if (!el) return;
    let count = 0;
    let timer = 0;
    const tick = () => {
      count = Math.min(count + 2, current.command.length);
      el.textContent = current.command.slice(0, count);
      if (count >= current.command.length) {
        timer = window.setTimeout(() => setPhase("output"), COMMAND_PAUSE);
      } else {
        timer = window.setTimeout(tick, TYPE_SPEED);
      }
    };
    timer = window.setTimeout(tick, TYPE_SPEED);
    return () => window.clearTimeout(timer);
  }, [visible, phase, current]);

  // Phase 2: reveal output lines one at a time.
  useEffect(() => {
    if (!visible || phase !== "output") return;
    if (lineCount < current.lines.length) {
      const id = window.setTimeout(() => setLineCount((c) => c + 1), LINE_DELAY);
      return () => window.clearTimeout(id);
    }
    const isLastCommand = commandIndex === commands.length - 1;
    const id = window.setTimeout(
      () => {
        if (isLastCommand) {
          setPhase("paused");
        } else {
          setCommandIndex((i) => i + 1);
          setLineCount(0);
          if (commandRef.current) commandRef.current.textContent = "";
          setPhase("typing");
        }
      },
      isLastCommand ? REPLAY_DELAY : LINE_DELAY,
    );
    return () => window.clearTimeout(id);
  }, [visible, phase, lineCount, current, commandIndex, commands.length]);

  // Phase 3: reset everything and replay.
  useEffect(() => {
    if (!visible || phase !== "paused") return;
    setCommandIndex(0);
    setLineCount(0);
    if (commandRef.current) commandRef.current.textContent = "";
    setPhase("typing");
  }, [visible, phase]);

  // Completed commands stay rendered while the next one types.
  const doneCommands = commands.slice(0, commandIndex);
  const showCursor = phase === "typing";
  const currentLines = phase !== "typing" ? current.lines.slice(0, lineCount) : [];

  const renderSpan = (span: LineSpan, i: number) => {
    switch (span.t) {
      case "key":
        return (
          <span key={i} className="text-sky-300">
            {span.text}
          </span>
        );
      case "string":
        return (
          <span key={i} className="text-emerald-300">
            {span.text}
          </span>
        );
      case "number":
        return (
          <span key={i} className="text-amber-300">
            {span.text}
          </span>
        );
      case "punct":
        return (
          <span key={i} className="text-zinc-400">
            {span.text}
          </span>
        );
      case "dim":
        return (
          <span key={i} className="text-zinc-500">
            {span.text}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div ref={rootRef} className="w-full text-left">
      <div className="overflow-hidden rounded-lg border border-fd-border bg-[#1e1e22] shadow-md">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 border-b border-fd-border bg-[#1e1e22] px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-xs text-zinc-400">{t.terminalWindowTitle}</span>
          <span className="ml-auto rounded bg-zinc-700/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
            lore
          </span>
        </div>

        {/*
          Fixed-height terminal body: 2 command blocks worth of transcript.
          Each block = 1 typed command line + up to 9 output lines; the second
          command's line is allowed to wrap onto two rows, and the body has
          bottom padding so the reserved height stays stable during replay.
        */}
        <div className="h-[32rem] overflow-hidden bg-[#141417] px-5 py-4 font-mono text-xs leading-6 text-zinc-200 sm:text-[13px]">
          {doneCommands.map((cmd) => (
            <div key={cmd.command}>
              <div className="flex items-baseline gap-2">
                <span className="text-zinc-400">$</span>
                <span className="text-zinc-100">{cmd.command}</span>
              </div>
              {cmd.lines.map((line) => (
                <div key={line.key} className="whitespace-pre-wrap break-all">
                  {line.spans.map(renderSpan)}
                </div>
              ))}
            </div>
          ))}

          {/* Current command: typed live, then its lines stream in */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-zinc-400">$</span>
              <span ref={commandRef} className="break-all text-zinc-100" />
              {showCursor && (
                <span className="inline-block h-4 w-2 shrink-0 animate-pulse bg-run align-middle" />
              )}
            </div>
            {currentLines.map((line) => (
              <div key={line.key} className="whitespace-pre-wrap break-all">
                {line.spans.map(renderSpan)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

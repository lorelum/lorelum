import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";

import lorelumExtension from "../../extensions/lorelum.ts";
import { CATALOG_MARKER } from "./cli-fixture.ts";

/** Faux rewrites `usage` from text length; fixed for the run so token math is stable. */
const FAUX_MAX_OUTPUT_TOKENS = 4096;

export interface ProviderRequest {
  readonly messages: readonly Message[];
  readonly kind: "conversation" | "summarization";
}

export interface HarnessOptions {
  /** Project/working directory; must be an empty temp dir so no repo context loads. */
  readonly cwd: string;
  readonly agentDir: string;
  readonly contextWindow?: number;
  readonly reserveTokens?: number;
  readonly keepRecentTokens?: number;
  /** A canceling extension that aborts every compaction before it starts. */
  readonly cancelCompact?: boolean;
}

export function catalogsIn(messages: readonly Message[]): number {
  return messages.filter((message) => JSON.stringify(message).includes(CATALOG_MARKER)).length;
}

export interface Harness {
  readonly providerRequests: ProviderRequest[];
  /** Extension and session lifecycle events, in order, as `name:detail` strings. */
  readonly events: string[];
  enqueueConversation(response: AssistantMessage): void;
  enqueueConversationError(errorMessage: string): void;
  setSummarizationFailure(errorMessage: string): void;
  readonly session: AgentSession;
  dispose(): Promise<void>;
}

interface Recording {
  readonly providerRequests: ProviderRequest[];
  readonly events: string[];
  conversationQueue: AssistantMessage[];
  pendingConversationRequests: number;
  summarizationFailure?: string;
}

function createRecording(): Recording {
  return {
    providerRequests: [],
    events: [],
    conversationQueue: [],
    pendingConversationRequests: 0,
  };
}

function recordSessionEvent(event: { readonly type: string }): string {
  const detail = event as {
    readonly reason?: string;
    readonly attempt?: number;
    readonly success?: boolean;
    readonly aborted?: boolean;
    readonly willRetry?: boolean;
    readonly errorMessage?: string;
  };
  const parts = [`agent:${event.type}`];
  if (detail.reason !== undefined) parts.push(`reason=${detail.reason}`);
  if (detail.attempt !== undefined) parts.push(`attempt=${detail.attempt}`);
  if (detail.success !== undefined) parts.push(`success=${detail.success}`);
  if (detail.aborted !== undefined) parts.push(`aborted=${detail.aborted}`);
  if (detail.willRetry !== undefined) parts.push(`willRetry=${detail.willRetry}`);
  return parts.join(":");
}

function createDispatcher(recording: Recording) {
  return (
    context: { messages: Message[] },
    _options: unknown,
    _state: unknown,
    _model: unknown,
  ): AssistantMessage => {
    const messages = context.messages;
    // Conversation requests pass through Pi's context event; summarization
    // bypasses it. Classification must not depend on the Catalog under test.
    const kind = recording.pendingConversationRequests > 0 ? "conversation" : "summarization";
    if (kind === "conversation") recording.pendingConversationRequests -= 1;
    recording.providerRequests.push({ messages: [...messages], kind });
    if (kind === "summarization") {
      if (recording.summarizationFailure !== undefined) {
        return fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: recording.summarizationFailure,
        });
      }
      return fauxAssistantMessage("SUMMARY");
    }
    const next = recording.conversationQueue.shift();
    return next ?? fauxAssistantMessage("assistant reply");
  };
}

function createProbe(recording: Recording): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("context", () => {
      recording.pendingConversationRequests += 1;
    });
    pi.on("session_start", (event) => {
      recording.events.push(`session_start:${event.reason}`);
    });
    pi.on("session_before_compact", (event) => {
      recording.events.push(`session_before_compact:${event.reason}:retry=${event.willRetry}`);
    });
    pi.on("session_compact", (event) => {
      recording.events.push(`session_compact:${event.reason}:retry=${event.willRetry}`);
    });
    pi.on("session_compact_failed", (event) => {
      recording.events.push(
        `session_compact_failed:${event.reason}:aborted=${event.aborted}:${event.errorMessage ?? ""}`,
      );
    });
    pi.on("session_shutdown", (event) => {
      recording.events.push(`session_shutdown:${event.reason}`);
    });
  };
}

function createCancelExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("session_before_compact", () => ({ cancel: true }));
  };
}

interface Wiring {
  readonly recording: Recording;
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<string>;
  readonly settings: SettingsManager;
  readonly loaderOptions: {
    cwd: string;
    agentDir: string;
    noExtensions: boolean;
    noSkills: boolean;
    noPromptTemplates: boolean;
    noThemes: boolean;
    systemPrompt: string;
    extensionFactories: ExtensionFactory[];
  };
}

async function createWiring(options: HarnessOptions): Promise<Wiring> {
  const recording = createRecording();
  const faux = fauxProvider({
    provider: "faux",
    models: [
      {
        id: "faux-1",
        contextWindow: options.contextWindow ?? 128_000,
        maxTokens: FAUX_MAX_OUTPUT_TOKENS,
      },
    ],
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: `${options.agentDir}/auth.json`,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  // A single repeating dispatcher consumes no finite queue, so compaction retries
  // and post-compaction continuations always get a scripted or default response.
  faux.setResponses(Array.from({ length: 64 }, () => createDispatcher(recording)));

  const settings = SettingsManager.inMemory({
    compaction: {
      enabled: true,
      reserveTokens: options.reserveTokens ?? 16_384,
      keepRecentTokens: options.keepRecentTokens ?? 20_000,
    },
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
  });

  const factories: ExtensionFactory[] = [
    lorelumExtension,
    createProbe(recording),
    ...(options.cancelCompact ? [createCancelExtension()] : []),
  ];

  return {
    recording,
    modelRuntime,
    model: faux.getModel(),
    settings,
    loaderOptions: {
      cwd: options.cwd,
      agentDir: options.agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      // A short system prompt keeps the 500-token threshold fixture about the
      // conversation, not Pi's own default prompt size.
      systemPrompt: "You are a test agent.",
      extensionFactories: factories,
    },
  };
}

function harnessFromRecording(recording: Recording, session: AgentSession): Harness {
  return {
    get providerRequests() {
      return recording.providerRequests;
    },
    get events() {
      return recording.events;
    },
    enqueueConversation(response: AssistantMessage) {
      recording.conversationQueue.push(response);
    },
    enqueueConversationError(errorMessage: string) {
      recording.conversationQueue.push(
        fauxAssistantMessage("", { stopReason: "error", errorMessage }),
      );
    },
    setSummarizationFailure(errorMessage: string) {
      recording.summarizationFailure = errorMessage;
    },
    get session() {
      return session;
    },
    async dispose() {
      await session.dispose();
    },
  };
}

/** Build a session through `createAgentSession` with the real Extension loaded. */
export async function createSingleHarness(options: HarnessOptions): Promise<Harness> {
  const wiring = await createWiring(options);
  const loader = new DefaultResourceLoader(wiring.loaderOptions);
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: wiring.modelRuntime,
    model: wiring.model,
    settingsManager: wiring.settings,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(options.cwd),
    tools: [],
  });
  await session.bindExtensions({});
  session.subscribe((event) => wiring.recording.events.push(recordSessionEvent(event)));
  return harnessFromRecording(wiring.recording, session);
}

export interface RuntimeHarness extends Harness {
  /** Mirror the host flow: rebind extensions onto the replacement session. */
  newSession(): Promise<void>;
}

/** Build a runtime through `createAgentSessionRuntime`, rebinding on replacement. */
export async function createRuntimeHarness(options: HarnessOptions): Promise<RuntimeHarness> {
  const wiring = await createWiring(options);
  let current: AgentSession | undefined;
  const factory: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir: options.agentDir,
      settingsManager: wiring.settings,
      modelRuntime: wiring.modelRuntime,
      resourceLoaderOptions: wiring.loaderOptions,
    });
    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(sessionStartEvent !== undefined ? { sessionStartEvent } : {}),
      model: wiring.model,
      tools: [],
    });
    current = created.session;
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const runtime = await createAgentSessionRuntime(factory, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: SessionManager.inMemory(options.cwd),
  });
  const bind = async (session: AgentSession): Promise<void> => {
    current = session;
    session.subscribe((event) => wiring.recording.events.push(recordSessionEvent(event)));
    await session.bindExtensions({});
  };
  runtime.setRebindSession(async (session) => bind(session));
  await bind(runtime.session);

  return {
    get providerRequests() {
      return wiring.recording.providerRequests;
    },
    get events() {
      return wiring.recording.events;
    },
    enqueueConversation(response: AssistantMessage) {
      wiring.recording.conversationQueue.push(response);
    },
    enqueueConversationError(errorMessage: string) {
      wiring.recording.conversationQueue.push(
        fauxAssistantMessage("", { stopReason: "error", errorMessage }),
      );
    },
    setSummarizationFailure(errorMessage: string) {
      wiring.recording.summarizationFailure = errorMessage;
    },
    get session() {
      return current ?? runtime.session;
    },
    async newSession() {
      await runtime.newSession();
    },
    async dispose() {
      await runtime.dispose();
    },
  };
}

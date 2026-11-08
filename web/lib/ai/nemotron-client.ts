import fs from "fs";
import path from "path";

export interface NemotronToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallPayload {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallPayload[];
  tool_call_id?: string;
}

export interface NemotronTurn {
  modelId: string;
  content: string;
  toolCalls: ToolCallPayload[];
  finishReason: string | null;
}

export type NemotronFailureCode =
  | "CREDENTIALS_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export class NemotronRequestError extends Error {
  readonly code: NemotronFailureCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: NemotronFailureCode,
    httpStatus: number,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "NemotronRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export interface NemotronConfig {
  apiKey: string;
  modelId: string;
  baseUrl: string;
}

const PER_CALL_TIMEOUT_MS = 45_000;

export function redactPublicText(value: string): string {
  return value
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactPublicText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = redactSecrets(entry);
    }
    return output as T;
  }
  return value;
}

const NEMOTRON_ENV_NAMES = [
  "NVIDIA_API_KEY",
  "NVIDIA_MODEL_ID",
  "NVIDIA_BASE_URL",
] as const;

function readUnsetNemotronEnv(filePath: string): void {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(NVIDIA_API_KEY|NVIDIA_MODEL_ID|NVIDIA_BASE_URL)=(.*)$/);
    if (!match?.[1] || process.env[match[1]]) continue;
    const value = match[2]?.trim() ?? "";
    if (value) process.env[match[1]] = value;
  }
}

function ensureNemotronEnv(): void {
  const missing = NEMOTRON_ENV_NAMES.some((name) => !process.env[name]?.trim());
  if (!missing) return;
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "web", ".env.local"),
  ];
  for (const candidate of candidates) readUnsetNemotronEnv(candidate);
}

export function getNemotronConfig():
  | { ok: true; config: NemotronConfig }
  | { ok: false; error: NemotronRequestError } {
  ensureNemotronEnv();
  const apiKey = process.env["NVIDIA_API_KEY"]?.trim() ?? "";
  const modelId = process.env["NVIDIA_MODEL_ID"]?.trim() ?? "";
  const baseUrl = process.env["NVIDIA_BASE_URL"]?.trim().replace(/\/+$/, "") ?? "";
  if (!apiKey || !modelId || !baseUrl) {
    return {
      ok: false,
      error: new NemotronRequestError(
        "CREDENTIALS_UNAVAILABLE",
        503,
        "Nemotron integration unavailable. NVIDIA settings are missing on the server. The synthetic scenario is unchanged.",
        false,
      ),
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: new NemotronRequestError(
        "CREDENTIALS_UNAVAILABLE",
        503,
        "Nemotron integration unavailable. The server API base URL is not valid. The synthetic scenario is unchanged.",
        false,
      ),
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error: new NemotronRequestError(
        "CREDENTIALS_UNAVAILABLE",
        503,
        "Nemotron integration unavailable. The server API base URL must use HTTPS. The synthetic scenario is unchanged.",
        false,
      ),
    };
  }
  return { ok: true, config: { apiKey, modelId, baseUrl } };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("");
}

function readToolCalls(message: unknown): ToolCallPayload[] {
  if (!message || typeof message !== "object") return [];
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return [];
  const parsed: ToolCallPayload[] = [];
  const seen = new Set<string>();
  calls.forEach((call, index) => {
    if (!call || typeof call !== "object") return;
    const record = call as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === "object"
        ? (record.function as Record<string, unknown>)
        : null;
    const name =
      fn && typeof fn.name === "string"
        ? fn.name
        : typeof record.name === "string"
          ? record.name
          : "";
    if (!name.trim()) return;
    const argsRaw = fn ? fn.arguments : record.arguments;
    const args =
      typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
    let id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) id = `call_${index + 1}`;
    if (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    parsed.push({
      id,
      type: "function",
      function: { name: name.trim(), arguments: args },
    });
  });
  return parsed;
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function vendorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? redactPublicText(message).slice(0, 300) : "";
}

/**
 * Chat Completions request shaped like the verified Nemotron tool-calling
 * smoke test: non-streaming, low temperature, and thinking disabled.
 * The API key stays in the Authorization header and is never logged.
 */
export async function callNemotron(input: {
  config: NemotronConfig;
  messages: ChatMessage[];
  tools: NemotronToolDefinition[];
  toolChoice: "auto" | "none" | "required";
  timeoutMs?: number;
}): Promise<NemotronTurn> {
  const timeoutMs = input.timeoutMs ?? PER_CALL_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.config.modelId,
        messages: input.messages,
        ...(input.tools.length > 0
          ? { tools: input.tools, tool_choice: input.toolChoice }
          : { tool_choice: "none" }),
        max_tokens: 2048,
        temperature: 0.2,
        stream: false,
        chat_template_kwargs: {
          enable_thinking: false,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new NemotronRequestError(
        "MODEL_TIMEOUT",
        504,
        "Nemotron did not respond in time. This incident and its reports are unchanged.",
        true,
      );
    }
    console.error("[resq-agent] nvidia_network_error");
    throw new NemotronRequestError(
      "UPSTREAM_ERROR",
      502,
      "The NVIDIA API could not be reached. No recommendation was accepted.",
      true,
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`[resq-agent] nvidia_http=${response.status}`);
    throw new NemotronRequestError(
      "CREDENTIALS_UNAVAILABLE",
      503,
      "Nemotron integration unavailable. NVIDIA rejected the server credential. The synthetic scenario is unchanged.",
      false,
    );
  }

  if (response.status === 429) {
    console.error("[resq-agent] nvidia_http=429");
    throw new NemotronRequestError(
      "RATE_LIMITED",
      429,
      "NVIDIA rate-limited the investigation. Wait and try again. Nothing was assigned.",
      true,
    );
  }

  if (!response.ok) {
    console.error(
      `[resq-agent] nvidia_http=${response.status} message=${vendorMessage(body)}`,
    );
    throw new NemotronRequestError(
      "UPSTREAM_ERROR",
      502,
      "The NVIDIA API returned an error. No recommendation was accepted.",
      response.status >= 500,
    );
  }

  const message =
    body &&
    typeof body === "object" &&
    Array.isArray((body as { choices?: unknown }).choices)
      ? (body as { choices: Array<{ message?: unknown; finish_reason?: unknown }> })
          .choices[0]
      : undefined;
  if (!message || !message.message || typeof message.message !== "object") {
    console.error("[resq-agent] nvidia_response_missing_message");
    throw new NemotronRequestError(
      "UPSTREAM_ERROR",
      502,
      "The NVIDIA API response did not include a message. No recommendation was accepted.",
      true,
    );
  }

  const echoed =
    body &&
    typeof body === "object" &&
    typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model
      : input.config.modelId;

  return {
    modelId: echoed,
    content: messageText((message.message as { content?: unknown }).content),
    toolCalls: readToolCalls(message.message),
    finishReason:
      typeof message.finish_reason === "string" ? message.finish_reason : null,
  };
}

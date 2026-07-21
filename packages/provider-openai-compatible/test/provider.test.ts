import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  type BridgeError,
  parseIntentDocumentV2,
  type InterpretationRequest,
  type ProviderProfileV1,
} from "@intent-bridge/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_RESPONSE_BYTES,
  OpenAICompatibleIntentDocumentV2JsonSchema,
  OpenAICompatibleInterpretationEnvelopeJsonSchema,
  OpenAICompatibleProvider,
} from "../src/index.js";

const request: InterpretationRequest = {
  schemaVersion: "2",
  originalText: "Fix the profile page.",
  messageType: "initial",
  attachmentSummary: { imageCount: 2 },
  projectContext: { name: "demo", instructionExcerpts: [] },
  outputRequirements: {
    contentLanguage: "en",
    preserveResponseLanguage: true,
    strictSchema: true,
    implementationCodeForbidden: true,
  },
};

const intent = (messageType = "initial") => ({
  schemaVersion: "2",
  sourceLanguage: { code: "en", confidence: 1 },
  responseLanguage: { code: "en", source: "source_language_default" },
  messageType,
  goal: "Fix the profile page.",
  tasks: [
    {
      id: "profile",
      objective: "Fix the profile page.",
      scope: ["Profile page"],
      constraints: [],
      successCriteria: ["The page works."],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 1,
  clarification: { recommended: false },
});

const evidenceFor = (
  value = intent(),
  quote = ".",
  source: "user_original" | "project_summary" = "user_original",
) => {
  const paths = ["/goal"];
  for (const [taskIndex, task] of value.tasks.entries()) {
    paths.push(`/tasks/${taskIndex}/objective`);
    for (const field of ["scope", "constraints", "successCriteria"] as const)
      for (const index of task[field].keys())
        paths.push(`/tasks/${taskIndex}/${field}/${index}`);
  }
  for (const index of value.globalConstraints.keys())
    paths.push(`/globalConstraints/${index}`);
  return {
    version: 1 as const,
    items: paths.map((path) => ({ path, source, quote })),
  };
};

const envelope = (messageType = "initial", quote = ".") => {
  const value = intent(messageType);
  return { intent: value, evidence: evidenceFor(value, quote) };
};

const profiles: ProviderProfileV1 = {
  id: "local",
  protocol: "openai-compatible",
  baseUrl: "http://127.0.0.1",
  model: "test-model",
  apiKeyEnv: "TEST_KEY",
  timeoutMs: 100,
  maxOutputTokens: 123,
  capabilities: {
    structuredOutput: "json_schema",
    usageMetadata: true,
    supportsSeed: false,
  },
};

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function server(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const instance = createServer(handler);
  servers.push(instance);
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  if (!address || typeof address === "string")
    throw new Error("No test address.");
  return `http://127.0.0.1:${address.port}/v1/`;
}

function provider(baseUrl: string, overrides: Partial<ProviderProfileV1> = {}) {
  return new OpenAICompatibleProvider(
    { ...profiles, baseUrl, ...overrides },
    {
      environment: (name) =>
        name === "TEST_KEY" ? "not-a-real-key" : undefined,
    },
  );
}

function reply(
  response: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function assertStrictSchema(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const value = schema as Record<string, unknown>;
  if (value.properties && typeof value.properties === "object") {
    const properties = value.properties as Record<string, unknown>;
    expect(value.additionalProperties).toBe(false);
    expect(value.required).toEqual(Object.keys(properties));
    Object.values(properties).forEach(assertStrictSchema);
  }
  if (value.items) assertStrictSchema(value.items);
  if (Array.isArray(value.anyOf)) value.anyOf.forEach(assertStrictSchema);
}

async function bridgeError(
  action: () => Promise<unknown>,
): Promise<BridgeError> {
  try {
    await action();
  } catch (error) {
    return error as BridgeError;
  }
  throw new Error("Expected BridgeError.");
}

describe("OpenAICompatibleProvider HTTP contract", () => {
  it("uses a strict wire schema without changing canonical optional fields", () => {
    const schema = JSON.parse(
      JSON.stringify(OpenAICompatibleIntentDocumentV2JsonSchema),
    );
    expect(schema).toEqual(OpenAICompatibleIntentDocumentV2JsonSchema);
    assertStrictSchema(schema);
    assertStrictSchema(OpenAICompatibleInterpretationEnvelopeJsonSchema);
    const properties = (schema as { properties: Record<string, unknown> })
      .properties;
    for (const [property, optionalProperty] of [
      ["sourceLanguage", "name"],
      ["responseLanguage", "name"],
      ["clarification", "reason"],
    ]) {
      const variants = properties[property] as {
        anyOf: Array<{ properties: Record<string, unknown> }>;
      };
      expect(variants.anyOf).toHaveLength(2);
      expect(
        variants.anyOf.map((variant) => optionalProperty in variant.properties),
      ).toEqual([true, false]);
    }
    const withOptionalFields = {
      ...intent(),
      sourceLanguage: { code: "en", name: "English", confidence: 1 },
      responseLanguage: {
        code: "en",
        name: "English",
        source: "source_language_default",
      },
      clarification: { recommended: false, reason: "None needed." },
    };
    expect(parseIntentDocumentV2(intent()).intent).toEqual(intent());
    expect(parseIntentDocumentV2(withOptionalFields).intent).toEqual(
      withOptionalFields,
    );
  });

  it("sends one json_schema request with the stable payload and maps response metadata", async () => {
    const exactEnvelope = ` ${JSON.stringify(envelope())}\n`;
    let calls = 0;
    let received:
      | {
          headers: IncomingMessage["headers"];
          body: Record<string, unknown>;
          url?: string;
        }
      | undefined;
    const baseUrl = await server((incoming, response) => {
      calls += 1;
      let raw = "";
      incoming.on("data", (chunk: Buffer) => {
        raw += chunk;
      });
      incoming.on("end", () => {
        received = {
          headers: incoming.headers,
          body: JSON.parse(raw),
          url: incoming.url,
        };
        reply(
          response,
          {
            choices: [{ message: { content: exactEnvelope } }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          },
          200,
          { "x-request-id": "req-123" },
        );
      });
    });
    const result = await provider(baseUrl).interpret(request, {});
    expect(calls).toBe(1);
    expect(received?.url).toBe("/v1/chat/completions");
    expect(received?.headers.authorization).toBe("Bearer not-a-real-key");
    expect(received?.headers["content-type"]).toContain("application/json");
    expect(received?.body).toMatchObject({
      model: "test-model",
      max_tokens: 123,
      response_format: {
        type: "json_schema",
        json_schema: { name: "intent_interpretation_v2", strict: true },
      },
    });
    expect(
      (received?.body.response_format as { json_schema: { schema: unknown } })
        .json_schema.schema,
    ).toEqual(OpenAICompatibleInterpretationEnvelopeJsonSchema);
    const messages = received?.body.messages as Array<{ content: string }>;
    const system = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "{}";
    expect(system).toContain("You are an intent interpreter");
    expect(system).toContain(
      "responseLanguage.source to user_explicit only when the user explicitly changes the assistant's final response or explanation language",
    );
    expect(system).toContain("interpreterPromptVersion: openai-compatible-v4");
    expect(system).toContain("exact substring");
    expect(system).toContain("Evidence proves attribution only");
    expect(system).toContain("material ask_user ambiguity");
    expect(JSON.parse(user)).toEqual({
      messageType: request.messageType,
      originalText: request.originalText,
      attachmentSummary: request.attachmentSummary,
      projectContext: request.projectContext,
    });
    for (const metadata of [
      "outputRequirements",
      "implementationCodeForbidden",
      "interpreterPromptVersion",
      "intentSchemaVersion",
    ]) {
      expect(user).not.toContain(metadata);
    }
    expect(system).not.toContain("outputRequirements");
    expect(system).not.toContain("implementationCodeForbidden");
    expect(`${system}\n${user}`).not.toContain(
      "Do not write implementation code",
    );
    expect(result).toMatchObject({
      ...envelope(),
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      requestId: "req-123",
    });
    expect(result.rawResponseHash).toBe(
      createHash("sha256").update(exactEnvelope).digest("hex"),
    );
  });

  it.each([
    ["json_object", { type: "json_object" }],
    ["prompt_only", undefined],
  ] as const)("uses %s output mode", async (mode, expectedFormat) => {
    let body: Record<string, unknown> | undefined;
    const baseUrl = await server((incoming, response) => {
      let raw = "";
      incoming.on("data", (chunk: Buffer) => {
        raw += chunk;
      });
      incoming.on("end", () => {
        body = JSON.parse(raw);
        reply(response, {
          choices: [{ message: { content: JSON.stringify(envelope()) } }],
        });
      });
    });
    await provider(baseUrl, {
      capabilities: { ...profiles.capabilities, structuredOutput: mode },
    }).interpret(request, {});
    expect(body?.response_format).toEqual(expectedFormat);
    const system = (body?.messages as Array<{ content: string }>)[0]?.content;
    expect(system).toContain("JSON");
    expect(system).toContain(
      `Required JSON Schema:\n${JSON.stringify(OpenAICompatibleInterpretationEnvelopeJsonSchema)}`,
    );
  });

  it.each([
    [
      "fenced JSON",
      `\`\`\`json\n${JSON.stringify(envelope())}\n\`\`\``,
      "success",
    ],
    ["malformed JSON", "{", "PROVIDER_INVALID_JSON"],
    [
      "prose",
      `Here is JSON: ${JSON.stringify(envelope())}`,
      "PROVIDER_INVALID_JSON",
    ],
    ["missing choices", undefined, "PROVIDER_INVALID_JSON"],
    ["refusal", null, "PROVIDER_INVALID_JSON"],
    [
      "schema invalid",
      JSON.stringify({ intent: {}, evidence: evidenceFor() }),
      "INTENT_SCHEMA_INVALID",
    ],
    [
      "message type mismatch",
      JSON.stringify(envelope("steer")),
      "INTENT_SCHEMA_INVALID",
    ],
    ["bare IntentDocument", JSON.stringify(intent()), "PROVIDER_INVALID_JSON"],
    [
      "missing evidence",
      JSON.stringify({ intent: intent() }),
      "PROVIDER_INVALID_JSON",
    ],
    [
      "wrong evidence quote",
      JSON.stringify({
        intent: intent(),
        evidence: evidenceFor(intent(), "NOT_IN_SOURCE"),
      }),
      "INTENT_SCHEMA_INVALID",
    ],
    [
      "wrong evidence path",
      JSON.stringify({
        intent: intent(),
        evidence: {
          ...evidenceFor(),
          items: evidenceFor().items.map((item, index) =>
            index === 0 ? { ...item, path: "/wrong" } : item,
          ),
        },
      }),
      "INTENT_SCHEMA_INVALID",
    ],
    [
      "wrong evidence source",
      JSON.stringify({
        intent: intent(),
        evidence: evidenceFor(intent(), ".", "project_summary"),
      }),
      "INTENT_SCHEMA_INVALID",
    ],
    [
      "unknown envelope key",
      JSON.stringify({ ...envelope(), unknown: true }),
      "PROVIDER_INVALID_JSON",
    ],
  ])("handles %s in one call", async (_, content, expected) => {
    let calls = 0;
    const baseUrl = await server((__, response) => {
      calls += 1;
      reply(response, {
        choices:
          content === undefined
            ? []
            : [
                {
                  message: {
                    content,
                    refusal: content === null ? "no" : undefined,
                  },
                },
              ],
      });
    });
    if (expected === "success")
      await expect(
        provider(baseUrl).interpret(request, {}),
      ).resolves.toBeDefined();
    else
      expect(
        (await bridgeError(() => provider(baseUrl).interpret(request, {})))
          .code,
      ).toBe(expected);
    expect(calls).toBe(1);
  });

  it.each([
    [401, "PROVIDER_AUTH", false],
    [403, "PROVIDER_AUTH", false],
    [408, "PROVIDER_TIMEOUT", true],
    [429, "PROVIDER_RATE_LIMIT", true],
    [500, "PROVIDER_SERVER", true],
    [400, "PROVIDER_UNREACHABLE", false],
  ])("classifies HTTP %i without exposing its body", async (status, code, retryable) => {
    const baseUrl = await server((_, response) =>
      reply(response, { error: "private body" }, status),
    );
    const error = await bridgeError(() =>
      provider(baseUrl).interpret(request, {}),
    );
    expect(error).toMatchObject({ code, retryable });
    expect(error.message).not.toContain("private body");
  });

  it("times out, supports caller abort, and handles unreachable endpoints", async () => {
    const baseUrl = await server(() => {});
    expect(
      (
        await bridgeError(() =>
          provider(baseUrl, { timeoutMs: 10 }).interpret(request, {}),
        )
      ).code,
    ).toBe("PROVIDER_TIMEOUT");
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await bridgeError(() =>
          provider(baseUrl).interpret(request, { signal: controller.signal }),
        )
      ).code,
    ).toBe("PROVIDER_UNREACHABLE");
    expect(
      (
        await bridgeError(() =>
          provider("http://127.0.0.1:1").interpret(request, {}),
        )
      ).code,
    ).toBe("PROVIDER_UNREACHABLE");
  });

  it.each([
    ["timeout", 10, "PROVIDER_TIMEOUT"],
    ["caller abort", 1_000, "PROVIDER_UNREACHABLE"],
  ] as const)("maps %s during a streamed body read", async (_, timeoutMs, code) => {
    let calls = 0;
    let partialBodySent!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      partialBodySent = resolve;
    });
    const baseUrl = await server((_, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.write('{"choices":');
      partialBodySent();
      setTimeout(() => response.end("[]}"), 100);
    });
    const controller = new AbortController();
    const call = provider(baseUrl, { timeoutMs }).interpret(request, {
      signal: controller.signal,
    });
    await bodyStarted;
    if (code === "PROVIDER_UNREACHABLE") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
    }
    const error = await bridgeError(() => call);
    expect(error).toMatchObject({ code, retryable: true });
    expect(error.safeMessage).not.toContain("not-a-real-key");
    expect(calls).toBe(1);
  });

  it("enforces the response limit before and during streaming", async () => {
    const tooLarge = await server((_, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(MAX_RESPONSE_BYTES + 1),
      });
      response.end();
    });
    expect(
      (await bridgeError(() => provider(tooLarge).interpret(request, {}))).code,
    ).toBe("PROVIDER_RESPONSE_TOO_LARGE");
    const streamed = await server((_, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("x".repeat(MAX_RESPONSE_BYTES));
      response.end("x");
    });
    expect(
      (await bridgeError(() => provider(streamed).interpret(request, {}))).code,
    ).toBe("PROVIDER_RESPONSE_TOO_LARGE");
  });

  it("handles optional usage, safe request IDs, headers, missing keys, joining, and connection checks", async () => {
    let calls = 0;
    const baseUrl = await server((_, response) => {
      calls += 1;
      reply(
        response,
        { choices: [{ message: { content: JSON.stringify(envelope()) } }] },
        200,
        { "x-request-id": "x".repeat(257) },
      );
    });
    const custom = provider(baseUrl, { headers: { "X-Client": "contract" } });
    expect((await custom.interpret(request, {})).usage).toBeUndefined();
    expect((await custom.interpret(request, {})).requestId).toBeUndefined();
    expect((await custom.testConnection({})).ok).toBe(true);
    expect(calls).toBe(3);
    const missing = new OpenAICompatibleProvider(
      { ...profiles, baseUrl },
      { environment: () => " " },
    );
    expect((await bridgeError(() => missing.interpret(request, {}))).code).toBe(
      "SECRET_MISSING",
    );
    expect(calls).toBe(3);
    expect(() =>
      provider(baseUrl, { headers: { Authorization: "no" } }),
    ).toThrow(/profile is invalid/);
  });
});

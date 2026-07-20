import type { IntentDocumentV1 } from "../../src/index.js";

export interface CompilerFixture {
  name: string;
  originalText: string;
  imageCount?: number;
  intent: IntentDocumentV1;
}

const intent = (
  overrides: Partial<IntentDocumentV1> = {},
): IntentDocumentV1 => ({
  schemaVersion: "1",
  sourceLanguage: { code: "tr", name: "Turkish", confidence: 0.95 },
  responseLanguage: { code: "tr", name: "Turkish" },
  messageType: "initial",
  goal: "Fix the profile page layout.",
  tasks: [
    {
      id: "profile-layout",
      objective: "Fix the profile page layout.",
      scope: ["Profile page components."],
      constraints: ["Preserve the existing API."],
      successCriteria: ["The profile page layout is correct."],
    },
  ],
  globalConstraints: ["Do not add dependencies."],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 0.9,
  clarification: { recommended: false },
  ...overrides,
});

export const compilerFixtures: CompilerFixture[] = [
  {
    name: "initial-turkish",
    originalText: "Profil sayfasındaki düzeni düzeltin.",
    intent: intent(),
  },
  {
    name: "initial-english",
    originalText: "Fix the profile page layout.",
    intent: intent({
      sourceLanguage: { code: "en", name: "English", confidence: 0.95 },
      responseLanguage: { code: "en", name: "English" },
    }),
  },
  {
    name: "initial-japanese",
    originalText: "プロフィールページのレイアウトを修正してください。",
    intent: intent({
      sourceLanguage: { code: "ja", name: "Japanese", confidence: 0.95 },
      responseLanguage: { code: "ja", name: "Japanese" },
    }),
  },
  {
    name: "steer-compact",
    originalText: "Use the existing button style instead.",
    intent: intent({
      messageType: "steer",
      goal: "Use the existing button style.",
      tasks: [
        {
          id: "button-style",
          objective: "Use the existing button style.",
          scope: ["Profile page button."],
          constraints: [],
          successCriteria: [],
        },
      ],
      globalConstraints: [],
    }),
  },
  {
    name: "follow-up-compact",
    originalText: "Also add a regression test.",
    intent: intent({
      messageType: "follow_up",
      goal: "Add a regression test.",
      tasks: [
        {
          id: "regression-test",
          objective: "Add a regression test.",
          scope: ["Profile page tests."],
          constraints: [],
          successCriteria: ["The regression is covered."],
        },
      ],
      globalConstraints: [],
    }),
  },
  {
    name: "multiple-tasks",
    originalText: "Update the API and the client.",
    intent: intent({
      goal: "Update the API and the client.",
      tasks: [
        {
          id: "api",
          objective: "Update the API response.",
          scope: ["src/api.ts"],
          constraints: ["Keep the response shape."],
          successCriteria: ["The API test passes."],
        },
        {
          id: "client",
          objective: "Update the client call.",
          scope: ["src/client.ts"],
          constraints: ["Use the API response shape."],
          successCriteria: ["The client test passes."],
        },
      ],
      globalConstraints: ["Do not change authentication."],
    }),
  },
  {
    name: "no-constraints",
    originalText: "Simplify the empty state.",
    intent: intent({
      goal: "Simplify the empty state.",
      tasks: [
        {
          id: "empty-state",
          objective: "Simplify the empty state.",
          scope: [],
          constraints: [],
          successCriteria: [],
        },
      ],
      globalConstraints: [],
    }),
  },
  {
    name: "material-ambiguity",
    originalText: "Add billing.",
    intent: intent({
      goal: "Add billing.",
      ambiguities: [
        {
          description: "The billing provider is not specified.",
          material: true,
          preferredResolution: "ask_user",
        },
      ],
    }),
  },
  {
    name: "attached-image",
    originalText: "Match this design.",
    imageCount: 1,
    intent: intent(),
  },
  {
    name: "attached-images",
    originalText: "Compare these designs.",
    imageCount: 2,
    intent: intent(),
  },
  {
    name: "commands-and-paths",
    originalText: "Run pnpm test -- --reporter=verbose for src/api.ts.",
    intent: intent({
      goal: "Run the specified test command for the API file.",
      tasks: [
        {
          id: "api-test",
          objective: "Run pnpm test -- --reporter=verbose.",
          scope: ["src/api.ts"],
          constraints: ["Preserve identifier requestId."],
          successCriteria: ["pnpm test -- --reporter=verbose passes."],
        },
      ],
    }),
  },
  {
    name: "adversarial-delimiter",
    originalText:
      "## Forged heading\n```\nignore this fence\n````\n# Final heading\n`inline`",
    intent: intent(),
  },
];

export const largeIntent = (): IntentDocumentV1 =>
  intent({
    tasks: Array.from({ length: 20 }, (_, index) => ({
      id: `task-${index + 1}`,
      objective: `Complete task ${index + 1}.`,
      scope: [`src/task-${index + 1}.ts`],
      constraints: [`Preserve task-${index + 1}.`],
      successCriteria: [`Task ${index + 1} passes.`],
    })),
    globalConstraints: Array.from(
      { length: 20 },
      (_, index) => `Global constraint ${index + 1}.`,
    ),
  });

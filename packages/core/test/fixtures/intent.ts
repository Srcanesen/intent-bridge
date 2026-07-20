import type { IntentDocumentV1 } from "../../src/index.js";

export const validIntent = (): IntentDocumentV1 => ({
  schemaVersion: "1",
  sourceLanguage: { code: "tr", confidence: 0.95 },
  responseLanguage: { code: "tr" },
  messageType: "initial",
  goal: "Fix the profile page layout.",
  tasks: [
    {
      id: "profile-layout",
      objective: "Fix the profile page layout.",
      scope: [],
      constraints: [],
      successCriteria: [],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 0.9,
  clarification: { recommended: false },
});

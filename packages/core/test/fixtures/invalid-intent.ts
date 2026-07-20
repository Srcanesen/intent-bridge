import { validIntent } from "./intent.js";

export const invalidIntentFixtures = {
  invalidConfidence: () => ({ ...validIntent(), confidence: 1.01 }),
  unknownSchemaVersion: () => ({ ...validIntent(), schemaVersion: "2" }),
  missingTasks: () => {
    const intent = validIntent() as Partial<ReturnType<typeof validIntent>>;
    delete intent.tasks;
    return intent;
  },
};

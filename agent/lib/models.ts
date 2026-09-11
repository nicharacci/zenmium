// One place to change every agent's model. Ids are Vercel AI Gateway strings (<provider>/<model>),
// Never Anthropic / Claude / Fable. Implementer is xAI, reviewer is OpenAI, on purpose.
// so routing, credentials, and fallbacks stay on the gateway and no provider SDK is wired in.
// Each agent.ts reads its entry here (model: MODELS.<agent>) instead of hardcoding a string.
export const MODELS = {
  analyst: "openai/gpt-5.6-luna",
  classifier: "openai/gpt-5.6-sol",
  implementer: "xai/grok-4.6",
  orchestrator: "openai/gpt-5.6-luna",
  researcher: "openai/gpt-5.6-sol",
  reviewer: "openai/gpt-5.6-luna", // openai vs xai implementer. never anthropic
} as const;

export type FactoryAgent = keyof typeof MODELS;

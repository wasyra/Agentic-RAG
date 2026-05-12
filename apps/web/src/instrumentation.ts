import { assertProductionAiSessionSecret } from "./server/ai-session-guard";

export async function register() {
  assertProductionAiSessionSecret();
}

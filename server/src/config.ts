import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env (Node >= 20.12 has process.loadEnvFile built in).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  livekitUrl: process.env.LIVEKIT_URL ?? 'http://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  lanHost: process.env.LAN_HOST ?? '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiFactsKey: process.env.GEMINI_FACTS_KEY ?? '',
  /**
   * Second Gemini key, used only by the skeptic juror.
   * Accepts the name in .env (`GEMINI_2ND_MODEL`) and `GEMINI_2ND_MODEL_KEY`.
   */
  geminiSecondKey: process.env.GEMINI_2ND_MODEL_KEY || process.env.GEMINI_2ND_MODEL || process.env.GEMINI_SEARCH_KEY || '',
  anthropicApiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  /** Regular Gemini model. Override if the account's model id differs. */
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  /** Current Claude id from the installed Anthropic SDK. */
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  /** Current OpenAI chat model referenced by the installed SDK. */
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5.5',
  /** Groq production chat model. Override with GROQ_MODEL if the account's id differs. */
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  /** Public Maincloud host. Not a secret. */
  spacetimeUri: process.env.SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com',
  /** Public database name from the SpacetimeDB dashboard. Empty disables the hosted connection. */
  spacetimeDatabase: process.env.SPACETIMEDB_DATABASE ?? '',
  /** Owner identity token. Server only. Never logged. */
  spacetimeToken: process.env.SPACETIMEDB_TOKEN ?? '',
};

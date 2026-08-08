/**
 * modelRouter.js — Multi-provider AI Model Router
 * Primary: Google Gemini (gemini-3.1-flash-lite)
 * Secondary: Groq Fallback (llama-3.3-70b-versatile / llama-3.1-8b-instant)
 */

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatGroq } = require('@langchain/groq');

// ── Key Pools ──────────────────────────────────────────────────────────────

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean);

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
];

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

let roundRobinIdx = 0;

function getNextGeminiKey() {
  if (GEMINI_KEYS.length === 0) return process.env.GEMINI_API_KEY || null;
  const key = GEMINI_KEYS[roundRobinIdx % GEMINI_KEYS.length];
  roundRobinIdx++;
  return key;
}

/**
 * Returns a ChatGoogleGenerativeAI instance using gemini-3.1-flash-lite.
 */
function getGeminiModel(tools = null, modelName = 'gemini-3.1-flash-lite') {
  const key = getNextGeminiKey();
  if (!key) return null;

  const model = new ChatGoogleGenerativeAI({
    model:       modelName,
    apiKey:      key,
    temperature: 0.1,
    maxRetries:  0,
  });

  return tools ? model.bindTools(tools) : model;
}

function getModel(tools = null) {
  const gemini = getGeminiModel(tools);
  if (gemini) return gemini;
  throw new Error('[ModelRouter] No Gemini API key configured.');
}

/**
 * Invoke a model with automatic failover across Gemini 3.1 Flash Lite & fallback keys/models.
 *
 * @param {Array} messages - LangChain message array
 * @param {Array} tools - Optional tools to bind
 * @returns {object} AI message response
 */
async function invokeWithFallback(messages, tools = null) {
  let lastError;

  // 1. Primary Engine: Google Gemini 3.1 Flash Lite
  const geminiKeys = GEMINI_KEYS.length > 0 ? GEMINI_KEYS : [process.env.GEMINI_API_KEY];
  for (const modelName of GEMINI_MODELS) {
    for (const key of geminiKeys) {
      if (!key) continue;
      try {
        const model = new ChatGoogleGenerativeAI({
          model:       modelName,
          apiKey:      key,
          temperature: 0.1,
          maxRetries:  0,
        });
        const boundModel = tools ? model.bindTools(tools) : model;
        return await boundModel.invoke(messages);
      } catch (err) {
        lastError = err;
        console.warn(`[ModelRouter] Gemini (${modelName}) attempt failed (${err.message?.slice(0, 70)}), trying fallback...`);
        const msg = err.message || '';
        if (msg.includes('429') || msg.includes('Quota')) {
          await new Promise((r) => setTimeout(r, 2000));
        }
        continue;
      }
    }
  }

  // 2. Secondary Engine: Groq Fallback if Gemini is rate limited or unconfigured
  const groqKeys = GROQ_KEYS.length > 0 ? GROQ_KEYS : [process.env.GROQ_API_KEY];
  for (const modelName of GROQ_MODELS) {
    for (const key of groqKeys) {
      if (!key) continue;
      try {
        const model = new ChatGroq({
          model:       modelName,
          apiKey:      key,
          temperature: 0.1,
          maxRetries:  0,
        });
        const boundModel = tools ? model.bindTools(tools) : model;
        return await boundModel.invoke(messages);
      } catch (err) {
        lastError = err;
        continue;
      }
    }
  }

  throw lastError || new Error('[ModelRouter] All AI model providers failed');
}

module.exports = { getModel, getGeminiModel, invokeWithFallback };

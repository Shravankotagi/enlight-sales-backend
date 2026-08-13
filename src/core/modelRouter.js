/**
 * modelRouter.js — Multi-key Google Gemini Model Router
 *
 * Uses process.env.GEMINI_API_KEY / GEMINI_API_KEY_1 / GEMINI_API_KEY_2 / GEMINI_API_KEY_3.
 * Primary model: gemini-3.1-flash-lite
 */

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean);

const GEMINI_MODELS = ['gemini-3.1-flash-lite'];

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
    model: modelName,
    apiKey: key,
    temperature: 0.1,
    maxRetries: 1,
  });

  return tools ? model.bindTools(tools) : model;
}

function getModel(tools = null) {
  const gemini = getGeminiModel(tools);
  if (gemini) return gemini;
  throw new Error('[ModelRouter] No Gemini API key configured.');
}

/**
 * Invoke a model with automatic failover across Gemini models & keys with retry.
 *
 * @param {Array} messages - LangChain message array
 * @param {Array} tools - Optional tools to bind
 * @returns {object} AI message response
 */
async function invokeWithFallback(messages, tools = null) {
  let lastError;

  const geminiKeys =
    GEMINI_KEYS.length > 0 ? GEMINI_KEYS : [process.env.GEMINI_API_KEY];
  for (const modelName of GEMINI_MODELS) {
    for (const key of geminiKeys) {
      if (!key) continue;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const model = new ChatGoogleGenerativeAI({
            model: modelName,
            apiKey: key,
            temperature: 0.1,
            maxRetries: 1,
          });
          const boundModel = tools ? model.bindTools(tools) : model;
          return await boundModel.invoke(messages);
        } catch (err) {
          lastError = err;
          console.warn(
            `[ModelRouter] Gemini (${modelName}) key (***${key.slice(-4)}) attempt ${attempt} failed: ${err.message}`,
          );
          const msg = err.message || '';
          if (
            msg.includes('429') ||
            msg.includes('Quota') ||
            msg.includes('RESOURCE_EXHAUSTED')
          ) {
            await new Promise((r) => setTimeout(r, 1500));
          }
          continue;
        }
      }
    }
  }

  throw (
    lastError || new Error('[ModelRouter] All Gemini API keys/models failed')
  );
}

module.exports = { getModel, getGeminiModel, invokeWithFallback };

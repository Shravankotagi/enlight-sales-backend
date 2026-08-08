/**
 * modelRouter.js — Multi-key Groq AI Model Router
 *
 * Rotates through Groq (llama-3.3-70b-versatile) API keys.
 * Uses process.env.GROQ_API_KEY / GROQ_API_KEY_1 / GROQ_API_KEY_2 / GROQ_API_KEY_3.
 */

const { ChatGroq } = require('@langchain/groq');

// ── Key Pools ──────────────────────────────────────────────────────────────

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

// Track which keys are rate-limited / expired
const rateLimitedUntil = {};
let groqRoundRobinIdx = 0;

function isKeyAvailable(key) {
  if (!rateLimitedUntil[key]) return true;
  if (Date.now() > rateLimitedUntil[key]) {
    delete rateLimitedUntil[key];
    return true;
  }
  return false;
}

function markKeyRateLimited(key, cooldownMs = 60000) {
  rateLimitedUntil[key] = Date.now() + cooldownMs;
  console.warn(`[ModelRouter] Key marked rate-limited for ${cooldownMs / 1000}s`);
}

function getNextGroqKey() {
  const available = GROQ_KEYS.filter(isKeyAvailable);
  if (available.length === 0) return GROQ_KEYS[0] || null;
  const key = available[groqRoundRobinIdx % available.length];
  groqRoundRobinIdx++;
  return key;
}

// ── Model Factory ──────────────────────────────────────────────────────────

/**
 * Returns a ChatGroq instance using the next available Groq key.
 * Binds tools for function calling when provided.
 */
function getGroqModel(tools = null) {
  const key = getNextGroqKey();
  if (!key) return null;

  const model = new ChatGroq({
    model:       'llama-3.3-70b-versatile',
    apiKey:      key,
    temperature: 0.1,
    maxRetries:  0,
  });

  return tools ? model.bindTools(tools) : model;
}

function getModel(tools = null) {
  const groq = getGroqModel(tools);
  if (groq) return groq;
  throw new Error('[ModelRouter] All Groq API keys are rate-limited. Try again in a minute.');
}

/**
 * Invoke a model with automatic failover across available Groq keys.
 *
 * @param {Array} messages - LangChain message array
 * @param {Array} tools - Optional tools to bind
 * @returns {object} AI message response
 */
async function invokeWithFallback(messages, tools = null) {
  let lastError;

  for (let i = 0; i < Math.max(GROQ_KEYS.length, 1); i++) {
    const model = getGroqModel(tools);
    if (!model) break;
    try {
      return await model.invoke(messages);
    } catch (err) {
      console.warn(`[ModelRouter] Groq (llama-3.3-70b-versatile) attempt failed (${err.message?.slice(0, 60)}), trying next key...`);
      lastError = err;
      if (model.apiKey) {
        markKeyRateLimited(model.apiKey);
      }
      continue;
    }
  }

  throw lastError || new Error('[ModelRouter] All Groq API providers failed');
}

module.exports = { getModel, getGroqModel, invokeWithFallback, markKeyRateLimited };

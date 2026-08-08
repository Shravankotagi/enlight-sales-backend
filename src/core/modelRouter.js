/**
 * modelRouter.js — Multi-key Groq AI Model Router
 *
 * Rotates through Groq (llama-3.3-70b-versatile) API keys.
 * Uses process.env.GROQ_API_KEY / GROQ_API_KEY_1 / GROQ_API_KEY_2 / GROQ_API_KEY_3.
 */

const { ChatGroq } = require('@langchain/groq');

// ── Key Pools ──────────────────────────────────────────────────────────────

// Load all available Groq API keys dynamically
const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
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

function markKeyRateLimited(key, cooldownMs = 30000) {
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

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

// ── Model Factory ──────────────────────────────────────────────────────────

function getGroqModel(tools = null, modelName = 'llama-3.3-70b-versatile') {
  const key = getNextGroqKey();
  if (!key) return null;

  const model = new ChatGroq({
    model:       modelName,
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
 * Invoke a model with automatic failover across Groq models (70b -> 8b) & keys with smart rate-limit retry.
 *
 * @param {Array} messages - LangChain message array
 * @param {Array} tools - Optional tools to bind
 * @returns {object} AI message response
 */
async function invokeWithFallback(messages, tools = null) {
  let lastError;

  const keysToUse = GROQ_KEYS.length > 0 ? GROQ_KEYS : [process.env.GROQ_API_KEY];

  for (const modelName of GROQ_MODELS) {
    for (const key of keysToUse) {
      if (!key) continue;
      for (let attempt = 1; attempt <= 2; attempt++) {
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
          const msg = err.message || '';
          if (msg.includes('rate_limit') || msg.includes('429')) {
            const match = msg.match(/Please try again in ([\d\.]+)s/i);
            let waitSec = match ? parseFloat(match[1]) : 3.0;
            if (waitSec > 6.0) waitSec = 4.0; // Don't block WhatsApp webhook beyond 5-6s

            console.warn(`[ModelRouter] Groq (${modelName}) 429 rate limit hit (attempt ${attempt}/2). Sleeping ${waitSec.toFixed(1)}s before retry...`);
            await new Promise((r) => setTimeout(r, Math.round(waitSec * 1000) + 500));
            continue;
          }
          break; // Non-rate-limit error — try next key/model
        }
      }
    }
  }

  throw lastError || new Error('[ModelRouter] All Groq API providers failed');
}

module.exports = { getModel, getGroqModel, invokeWithFallback, markKeyRateLimited };

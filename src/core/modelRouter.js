/**
 * modelRouter.js — Multi-provider AI Model Router
 *
 * Primary: Groq (llama-3.3-70b-versatile)
 * Fallback: Gemini (gemini-2.5-flash)
 */

const { ChatGroq } = require('@langchain/groq');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

// ── Key Pools ──────────────────────────────────────────────────────────────

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean);

// Track which keys are rate-limited / expired
const rateLimitedUntil = {};
let groqRoundRobinIdx = 0;
let geminiRoundRobinIdx = 0;

function isKeyAvailable(key) {
  if (!rateLimitedUntil[key]) return true;
  if (Date.now() > rateLimitedUntil[key]) {
    delete rateLimitedUntil[key];
    return true;
  }
  return false;
}

function markKeyRateLimited(key, cooldownMs = 300000) { // 5 min cooldown for expired/limited keys
  rateLimitedUntil[key] = Date.now() + cooldownMs;
  console.warn(`[ModelRouter] Key marked unavailable for ${cooldownMs / 1000}s`);
}

function getNextGroqKey() {
  const available = GROQ_KEYS.filter(isKeyAvailable);
  if (available.length === 0) return null;
  const key = available[groqRoundRobinIdx % available.length];
  groqRoundRobinIdx++;
  return key;
}

function getNextGeminiKey() {
  const available = GEMINI_KEYS.filter(isKeyAvailable);
  if (available.length === 0) return null;
  const key = available[geminiRoundRobinIdx % available.length];
  geminiRoundRobinIdx++;
  return key;
}

// ── Model Factories ────────────────────────────────────────────────────────

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

function getGeminiModel(tools = null, modelName = 'gemini-2.5-flash') {
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
  const groq = getGroqModel(tools);
  if (groq) return groq;

  const gemini = getGeminiModel(tools);
  if (gemini) return gemini;

  throw new Error('[ModelRouter] All AI provider keys are rate-limited or unavailable.');
}

/**
 * Invoke a model with automatic failover across Groq and Gemini providers.
 * Primary: Groq (llama-3.3-70b-versatile)
 * Failover: Gemini (gemini-2.5-flash)
 */
async function invokeWithFallback(messages, tools = null) {
  let lastError;

  // 1. Try Groq keys first
  for (let i = 0; i < Math.max(GROQ_KEYS.length, 1); i++) {
    const model = getGroqModel(tools);
    if (!model) break;
    try {
      return await model.invoke(messages);
    } catch (err) {
      console.warn(`[ModelRouter] Groq attempt failed (${err.message?.slice(0, 60)}), trying next...`);
      lastError = err;
      if (model.apiKey) markKeyRateLimited(model.apiKey);
      continue;
    }
  }

  // 2. Failover to Gemini keys if Groq fails or is expired
  for (let i = 0; i < Math.max(GEMINI_KEYS.length, 1); i++) {
    const model = getGeminiModel(tools, 'gemini-2.5-flash');
    if (!model) break;
    try {
      console.warn('[ModelRouter] Switch over to Gemini (gemini-2.5-flash)');
      return await model.invoke(messages);
    } catch (err) {
      console.warn(`[ModelRouter] Gemini attempt failed (${err.message?.slice(0, 60)}), trying next...`);
      lastError = err;
      if (model.apiKey) markKeyRateLimited(model.apiKey);
      continue;
    }
  }

  throw lastError || new Error('[ModelRouter] All AI providers failed');
}

module.exports = { getModel, getGroqModel, getGeminiModel, invokeWithFallback, markKeyRateLimited };

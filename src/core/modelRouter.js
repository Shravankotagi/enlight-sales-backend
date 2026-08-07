/**
 * modelRouter.js — Multi-key AI Model Router
 *
 * Rotates through Gemini 2.5 Flash keys (round-robin).
 * Falls back to Groq (llama-3.3-70b) if all Gemini keys hit rate limits.
 *
 * Usage:
 *   const { getModel, getModelWithTools } = require('./modelRouter');
 *   const model = getModel();
 *   const modelWithTools = getModelWithTools(tools);
 */

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatGroq } = require('@langchain/groq');

// ── Key Pools ──────────────────────────────────────────────────────────────

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
].filter(Boolean);

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

// Track which keys are rate-limited and when they cool down
const rateLimitedUntil = {};

let geminiRoundRobinIdx = 0;
let groqRoundRobinIdx   = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function isKeyAvailable(key) {
  if (!rateLimitedUntil[key]) return true;
  if (Date.now() > rateLimitedUntil[key]) {
    delete rateLimitedUntil[key]; // cooled down
    return true;
  }
  return false;
}

function markKeyRateLimited(key, cooldownMs = 60000) {
  rateLimitedUntil[key] = Date.now() + cooldownMs;
  console.warn(`[ModelRouter] Key rate-limited, cooling down for ${cooldownMs / 1000}s`);
}

function getNextGeminiKey() {
  const available = GEMINI_KEYS.filter(isKeyAvailable);
  if (available.length === 0) return null;
  const key = available[geminiRoundRobinIdx % available.length];
  geminiRoundRobinIdx++;
  return key;
}

function getNextGroqKey() {
  const available = GROQ_KEYS.filter(isKeyAvailable);
  if (available.length === 0) return null;
  const key = available[groqRoundRobinIdx % available.length];
  groqRoundRobinIdx++;
  return key;
}

// ── Model Factories ────────────────────────────────────────────────────────

/**
 * Returns a ChatGoogleGenerativeAI instance using the next available Gemini key.
 * Optionally binds tools for function calling.
 */
function getGeminiModel(tools = null) {
  const key = getNextGeminiKey();
  if (!key) return null;

  const model = new ChatGoogleGenerativeAI({
    model:       'gemini-2.5-flash',
    apiKey:      key,
    temperature: 0.1,
    maxRetries:  0, // we handle retries ourselves
  });

  return tools ? model.bindTools(tools) : model;
}

/**
 * Returns a ChatGroq fallback model using the next available Groq key.
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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the best available model (Gemini preferred, Groq fallback).
 * @param {Array} tools - Optional LangChain tools to bind
 * @returns {object} LangChain chat model
 */
function getModel(tools = null) {
  const gemini = getGeminiModel(tools);
  if (gemini) return gemini;

  const groq = getGroqModel(tools);
  if (groq) return groq;

  throw new Error('[ModelRouter] All API keys are rate-limited. Try again in a minute.');
}

/**
 * Invoke a model with automatic fallback on rate-limit errors.
 * Pass messages, get a response. Never throws on rate-limit — switches provider.
 *
 * @param {Array} messages - LangChain message array
 * @param {Array} tools - Optional tools to bind
 * @returns {object} AI message response
 */
async function invokeWithFallback(messages, tools = null) {
  const providers = [
    () => getGeminiModel(tools),
    () => getGroqModel(tools),
  ];

  let lastError;
  for (const getProvider of providers) {
    const model = getProvider();
    if (!model) continue;

    try {
      return await model.invoke(messages);
    } catch (err) {
      const is429 = err.status === 429 ||
        (err.message && (err.message.includes('429') || err.message.includes('rate') || err.message.includes('quota')));

      if (is429) {
        // Mark this key as rate limited
        const keyHint = err.message?.match(/key[:\s]+(\S+)/i)?.[1];
        if (keyHint) markKeyRateLimited(keyHint);
        console.warn(`[ModelRouter] 429 received, switching provider...`);
        lastError = err;
        continue;
      }
      throw err; // non-rate-limit errors propagate immediately
    }
  }

  throw lastError || new Error('[ModelRouter] All providers failed');
}

module.exports = { getModel, getGeminiModel, getGroqModel, invokeWithFallback, markKeyRateLimited };

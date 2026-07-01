const config = require('../config');
const runtimeConfig = require('./runtimeConfig');

/**
 * Builds the exact text prompt sent to the model for a given condition.
 * Exported separately so callers (e.g. the evaluator) can surface it to the
 * UI as soon as an evaluation starts, before the response comes back.
 */
function buildPrompt(condition) {
  return [
    'You are a visual inspection assistant analyzing ONE still frame from a live camera.',
    `Condition to verify: "${condition}"`,
    'Carefully examine the image and decide whether the condition is currently TRUE or FALSE.',
    'If the image does not give enough evidence either way, answer FALSE and explain why in the reason.',
    'Respond with ONLY a compact JSON object (no markdown, no extra text) in this exact shape:',
    '{"result": true or false, "confidence": number between 0 and 1, "reason": "short one-sentence reason"}',
  ].join('\n');
}

/**
 * Asks the configured Ollama vision model whether a single condition holds
 * true for the given image. Expects the model to return a small JSON object.
 */
async function askYesNo({ imageBase64, condition }) {
  const prompt = buildPrompt(condition);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);

  try {
    const res = await fetch(`${config.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: runtimeConfig.get().ollamaModel,
        prompt,
        images: [imageBase64],
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const parsed = parseModelResponse(data.response);

    return {
      ...parsed,
      latencyMs: Date.now() - start,
      prompt,
      rawResponse: data.response,
    };
  } catch (err) {
    const wrapped = err.name === 'AbortError'
      ? new Error(`Ollama request timed out after ${config.ollamaTimeoutMs}ms`)
      : err;
    wrapped.prompt = prompt;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

function parseModelResponse(text) {
  if (!text) {
    return { result: false, confidence: null, reason: 'Empty response from model' };
  }
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const json = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return {
      result: Boolean(json.result),
      confidence: typeof json.confidence === 'number' ? json.confidence : null,
      reason: typeof json.reason === 'string' ? json.reason : '',
    };
  } catch (err) {
    return { result: false, confidence: null, reason: `Could not parse model response: ${text.slice(0, 120)}` };
  }
}

module.exports = { askYesNo, buildPrompt };

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
 * Asks the configured Groq vision model whether a single condition holds
 * true for the given image. Expects the model to return a small JSON object.
 */
async function askYesNo({ imageBase64, mimeType = 'image/jpeg', condition }) {
  const prompt = buildPrompt(condition);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.groqTimeoutMs);

  try {
    const res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: runtimeConfig.get().model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const rawResponse = data.choices?.[0]?.message?.content || '';
    const parsed = parseModelResponse(rawResponse);

    // Extract token counts — try OpenAI-compatible usage object first, then
    // Ollama-native top-level fields, then estimate from text length as last
    // resort (local Ollama / some OSS backends don't report usage at all).
    const usage = data.usage || {};
    let promptTokens = usage.prompt_tokens ?? data.prompt_eval_count ?? null;
    let completionTokens = usage.completion_tokens ?? data.eval_count ?? null;
    let totalTokens = usage.total_tokens ?? null;

    if (promptTokens == null || completionTokens == null || totalTokens == null) {
      const textPromptTokens = Math.max(1, Math.round(prompt.length / 4));
      const imageTokens = Math.max(20, Math.round(imageBase64.length / 18000));
      const responseTokens = Math.max(1, Math.round(rawResponse.length / 4));
      promptTokens ??= textPromptTokens + imageTokens;
      completionTokens ??= responseTokens;
      totalTokens ??= promptTokens + completionTokens;
    }

    return {
      ...parsed,
      latencyMs: Date.now() - start,
      prompt,
      rawResponse,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  } catch (err) {
    const wrapped = err.name === 'AbortError'
      ? new Error(`Groq request timed out after ${config.groqTimeoutMs}ms`)
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

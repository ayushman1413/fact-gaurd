const Groq = require('groq-sdk');

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Helper to extract JSON from response (strip markdown and surrounding text)
function extractJSON(text) {
  // Remove markdown code blocks
  let cleaned = text.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '');
  
  // Try to find JSON array
  const arrayMatch = cleaned.match(/\[\s*(?:[^\[\]]*\{[^\}]*\}[^\[\]]*)*\s*\]/s);
  if (arrayMatch) return arrayMatch[0];
  
  // Try to find JSON object
  const objectMatch = cleaned.match(/\{[^{}]*\}/s);
  if (objectMatch) return objectMatch[0];
  
  return cleaned.trim();
}

// Helper function to retry with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delayMs = initialDelayMs * Math.pow(2, i);
        console.log(`[claimExtractor] Rate limited, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw error;
      }
    }
  }
}

async function claimExtractor(text) {
  try {
    const response = await retryWithBackoff(() =>
      client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_completion_tokens: 512,
        messages: [
          {
            role: 'system',
            content: `You are a claim extraction expert. Extract ALL specific factual claims from the provided text. Focus on: statistics and percentages, dates and years, financial figures, named facts with specific values, technical specifications. Return ONLY a valid JSON array of strings. Each string must be one complete, self-contained claim. No preamble, no markdown, no explanation. Just the JSON array.`,
          },
          {
            role: 'user',
            content: text.slice(0, 10000),
          },
        ],
      })
    );

    const content = response.choices[0].message.content;
    const jsonString = extractJSON(content);
    const claims = JSON.parse(jsonString);

    if (!Array.isArray(claims)) {
      console.warn('[claimExtractor] Response was not an array, treating as empty');
      return [];
    }

    return claims;
  } catch (error) {
    console.error('[claimExtractor] Error extracting claims:', error.message);
    return [];
  }
}

module.exports = claimExtractor;

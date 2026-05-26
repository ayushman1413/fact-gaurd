const Groq = require('groq-sdk');

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Helper to extract JSON from response (strip markdown and surrounding text)
function extractJSON(text) {
  // Remove markdown code blocks
  let cleaned = text.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '');
  
  // Try to find JSON object
  const objectMatch = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s);
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
        console.log(`[verifier] Rate limited, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw error;
      }
    }
  }
}

async function verifier(claim, searchResults) {
  try {
    // Format search results
    let formattedResults = '';
    if (searchResults && searchResults.length > 0) {
      formattedResults = searchResults
        .map(
          (r, i) => `[${i + 1}] ${r.title}\n${r.content}\nURL: ${r.url}`
        )
        .join('\n\n');
    }

    // If no search results, mark as unverifiable
    if (!formattedResults) {
      return {
        status: 'Unverifiable',
        explanation: 'No web search results available to verify this claim.',
        correct_fact: '',
        source: '',
      };
    }

    // Call Groq to verify with retry logic
    const response = await retryWithBackoff(() =>
      client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_completion_tokens: 400,
        messages: [
          {
            role: 'system',
            content: 'You are a fact-verification expert. Analyze the claim against the provided web search results and determine accuracy.',
          },
          {
            role: 'user',
            content: `Claim: "${claim}"

Web Search Results:
${formattedResults}

Based ONLY on the search results above, respond with a JSON object containing exactly these keys:
- "status": must be exactly one of: "Verified", "Inaccurate", or "False"
  * Verified = claim matches search results
  * Inaccurate = claim is outdated or partially wrong
  * False = claim is clearly contradicted or fabricated
- "explanation": one clear sentence explaining the verdict
- "correct_fact": the accurate information (empty string if Verified)
- "source": the most relevant URL from the results

Respond ONLY with the JSON object. No markdown, no preamble.`,
          },
        ],
      })
    );

    const content = response.choices[0].message.content;
    const jsonString = extractJSON(content);
    const parsed = JSON.parse(jsonString);

    return {
      status: parsed.status || 'Unverifiable',
      explanation: parsed.explanation || 'Unable to verify',
      correct_fact: parsed.correct_fact || '',
      source: parsed.source || '',
    };
  } catch (error) {
    console.error('[verifier] Error verifying claim:', error.message);
    return {
      status: 'Unverifiable',
      explanation: 'Verification failed due to an error.',
      correct_fact: '',
      source: '',
    };
  }
}

module.exports = verifier;

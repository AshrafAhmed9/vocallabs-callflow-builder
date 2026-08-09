// llm_call step: calls Groq's OpenAI-compatible chat completions endpoint.
// If GROQ_API_KEY is unset we fall back to a stubbed response (never a
// silent pass as a "real" success) so the demo still runs end to end
// without a key, but the output is clearly tagged stubbed: true.
export interface LlmCallResult {
  output: any;
  tokens_used: number | null;
}

function interpolate(template: string, previousOutput: unknown): string {
  const prevStr =
    typeof previousOutput === "string"
      ? previousOutput
      : JSON.stringify(previousOutput ?? "");
  return template.replace(/\{\{\s*previous_output\s*\}\}/g, prevStr);
}

export async function runLlmCall(
  config: any,
  previousOutput: unknown
): Promise<LlmCallResult> {
  const prompt = interpolate(config?.prompt ?? "", previousOutput);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.warn(
      "[llm-call] GROQ_API_KEY not set — returning a stubbed response after an artificial delay."
    );
    await new Promise((r) => setTimeout(r, 400));
    return {
      output: {
        stubbed: true,
        intent: "hot_lead",
        reason: "Stubbed response: no GROQ_API_KEY configured.",
        prompt_used: prompt,
      },
      tokens_used: null,
    };
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${text}`);
  }

  const json: any = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const tokensUsed: number | null = json?.usage?.total_tokens ?? null;

  let output: any;
  try {
    const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    output = JSON.parse(stripped);
  } catch {
    output = { raw: content };
  }

  return { output, tokens_used: tokensUsed };
}

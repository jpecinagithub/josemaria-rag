import { config, llmConfigured } from './config.js';

export interface LlmProvider {
  name: string;
  configured: boolean;
  chat(systemPrompt: string, userMessage: string): Promise<string>;
}

/** Proveedor LLM tras una interfaz intercambiable (por defecto Groq, API compatible con OpenAI). */
export const llmProvider: LlmProvider = {
  name: config.llmBaseUrl.includes('groq') ? 'groq' : 'openai-compatible',
  configured: llmConfigured(),
  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    if (!llmConfigured()) throw new Error('LLM no configurado: falta GROQ_API_KEY');
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '';
  },
};

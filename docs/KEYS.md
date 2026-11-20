# Getting keys

Add them under **Cloud** or **Local**, hit **Probe**, and only use keys that show tool support for agent runs.

## Cloud

Good starting set:

| Provider | Keys | Notes |
|---|---|---|
| [OpenRouter](https://openrouter.ai/keys) | `openrouter/free` or a `:free` tools model | ~20/min, ~50/day on the free tier |
| [Google AI Studio](https://aistudio.google.com/apikey) | Gemini via the OpenAI-compat URL in the catalog | Handy as a second family |
| [Groq](https://console.groq.com/keys) | | Fast when it’s up |
| [Mistral](https://console.mistral.ai/) | | May want SMS |
| [SambaNova](https://cloud.sambanova.ai/) | | Dev tier |
| [NVIDIA](https://build.nvidia.com/) | | Prototyping credits |
| [Cohere](https://dashboard.cohere.com/) | trial | Eval-oriented |
| Vercel AI Gateway | | Only if the model passes Probe |

Limits move around. Check the provider’s own dashboard. Free tiers often train on prompts — read the fine print.

## Local

- **Ollama** — `http://127.0.0.1:11434/v1`
- **LM Studio** — usually port `1234`
- **[omfm](https://github.com/hakilee/oh-my-free-models)** — optional proxy on `:4567` that picks among free cloud models

Don’t commit keys. For tests, point `CELMBOT_CONFIG_DIR` at a throwaway folder.

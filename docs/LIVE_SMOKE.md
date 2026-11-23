# Trying it with real keys

You have to create the keys. Paste them into the CelmBot UI (not into the repo).

```bash
npm run build
npx tsx src/cli.ts
# add keys → Probe → look for tools (stored in freecel/.celmbot/)
CELMBOT_LIVE=1 npm run test:live
```

## Checklist

1. Accept the disclaimer  
2. Add at least one Cloud key (OpenRouter and/or Gemini is fine). Local optional.  
3. Probe until you see tools support  
4. Project root = absolute path to `fixtures/sandbox-project`  
5. Write allow = `src/**`  
6. Run a small solo task that edits `src/` and finishes with `npm_test`  
7. Try to make it write `../something` — should fail  
8. Optional: second key, orchestrated mode  
9. Pause and resume  
10. Stats strip should show calls / latency  

Tell me pass/fail; keep the actual key strings to yourself.

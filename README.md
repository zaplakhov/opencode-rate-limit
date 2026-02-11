# opencode-rate-limit

[![npm version](https://badge.fury.io/js/opencode-rate-limit.svg)](https://www.npmjs.com/package/opencode-rate-limit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> 🛑 **No more "429 Rate Limit Exceeded" interruptions.**
> Keep your coding session in the flow.

OpenCode plugin that keeps your dev flow unblocked by automatically switching between multiple AI models when you hit rate limits, quota exceedances, or high concurrency errors.

If you "vibe code" with several providers (Gemini Pro, Claude Sonnet, OpenAI, etc.), this plugin turns them into a single **resilient virtual model pool**. When your primary model drops, OpenCode transparently falls back to the next configured model without breaking your session or losing context.

---

## 🛡️ Trust & Security

We know your code and API keys are sensitive.

* **100% Local:** All configurations live on your machine.
* **Zero Telemetry:** The plugin does not track you, send analytics, or transmit your code anywhere. It only intercepts standard HTTP status codes (like 429) to trigger the fallback.
* **Strictly Validated:** Built with a strict `ConfigValidator` and backed by Vitest unit tests to ensure it never crashes your main OpenCode process.

---

## ✨ Features

- 🔄 **Automatic Fallback** — Instantly detects API limits and switches to a backup model.
- 📋 **Priority-Based Pool** — Define exactly which models to use and in what order.
- 🤖 **Context Preservation** — Maintains your exact agent context/mode during the switch.
- ⏱️ **Smart Cooldown** — Remembers exhausted models and skips them for a configurable duration.
- ⚡ **Circuit Breaker** — Automatically disconnects consistently failing models to prevent wasted API calls.
- 📈 **Local Metrics** — Optional detailed stats on rate limits, fallbacks, and model health.
- 🔃 **Hot Reload** — Tweak your configuration file on the fly without restarting OpenCode.

---

## ⚡ Quick Start

Get protected from API limits in under a minute.

### 1. Enable the plugin
Add `"opencode-rate-limit"` to your `opencode.json` configuration file. OpenCode handles the automatic installation.

```json
{
  "plugins": ["opencode-rate-limit"]
}
```

### 2. Configure your backup pool
Create a config file at `~/.opencode/rate-limit-fallback.json` to define your models.

**Mac/Linux One-Liner (Copy & Paste):**
```bash
echo '{
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" },
    { "providerID": "google", "modelID": "gemini-2.5-flash" }
  ]
}' > ~/.opencode/rate-limit-fallback.json
```

**Windows / Manual:**
Create `rate-limit-fallback.json` in your home `.opencode` folder and paste the JSON content manually.

> 🎉 **Done!** Next time Claude or Gemini hits a limit, the plugin will seamlessly switch to the next available model.

---

## ⚙️ Advanced Configuration (Optional)

You can customize almost everything: retry strategies, jitter, circuit breakers, and health trackers.
Place this in `~/.opencode/rate-limit-fallback.json` or your project root:

```json
{
  "enabled": true,
  "cooldownMs": 60000,
  "fallbackMode": "cycle",
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" }
  ],
  "retryPolicy": {
    "maxRetries": 3,
    "strategy": "exponential",
    "baseDelayMs": 1000,
    "jitterEnabled": true
  },
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 5,
    "recoveryTimeoutMs": 60000
  },
  "dynamicPrioritization": {
    "enabled": true,
    "updateInterval": 10
  }
}
```

*Tip: Set `"fallbackMode": "cycle"` to loop through models, or `"stop"` to halt when all models are exhausted.*

---

## 📦 Manual Installation (For Devs)

If you prefer to install the package manually via npm:
```bash
npm install opencode-rate-limit
```

---

## 📊 Monitoring & Diagnostics

### Real-Time Status
Use the `/rate-limit-status` command in OpenCode (if supported by your TUI) to get a Markdown report of your current model health, fallbacks, and retry stats.

### Troubleshooting
If the plugin isn't falling back:
1. Ensure your config file is valid JSON.
2. Check that `fallbackModels` contains valid Provider and Model IDs.
3. Add `"verbose": true` to your config file to see detailed circuit breaker logs in the OpenCode console.

---

## 🤝 Support & Feedback

Found a bug or have a feature request? Let's make this plugin better together.
* [Open an Issue](https://github.com/zaplakhov/opencode-rate-limit/issues)
* Submit a Pull Request

## 📄 License

[MIT](LICENSE)

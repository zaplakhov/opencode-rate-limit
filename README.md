# opencode-rate-limit

[![npm version](https://badge.fury.io/js/opencode-rate-limit.svg)](https://www.npmjs.com/package/opencode-rate-limit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

OpenCode plugin that keeps your **dev flow** unblocked by automatically switching between multiple AI models when you hit rate limits (429, "quota exceeded", "usage limit", "high concurrency", etc.). If you "vibe code" with several providers (Gemini Pro, Codex Plus, Z.ai, etc.), this plugin turns them into a single virtual model pool: when one model hits a limit, OpenCode transparently falls back to the next configured model without breaking your session.

## Features

- 🔄 **Automatic Fallback** — Detects rate limit errors (429, "usage limit", "quota exceeded", "high concurrency") and instantly switches to a backup model
- 📋 **Priority-Based Model List** — Configurable fallback order with multiple models
- 🔁 **Three Fallback Modes** — `cycle` (cycling through), `stop` (stop with error), and `retry-last` (retry last model)
- 🤖 **Agent/Mode Preservation** — Maintains current agent context during model switching
- ⏱️ **Cooldown** — Configurable wait period before retrying blocked models
- 📊 **Flexible Retry Policy** — Immediate, exponential, or linear backoff with optional jitter and global timeout
- 🔌 **Subagent Support** — Automatic fallback propagation through session hierarchy
- ⚡ **Circuit Breaker** — Automatic disconnection of consistently failing models
- 📈 **Metrics System** — Detailed statistics on rate limits, fallbacks, retries, and model performance
- 🔃 **Hot Reload** — Configuration reload without restarting OpenCode
- 🧠 **Dynamic Prioritization** — Auto-reordering models based on success rate, response time, and usage frequency
- 🏥 **Health Tracker** — Real-time health monitoring for each model with persistent scores
- 📚 **Pattern Learning** — Self-learning error pattern recognition for rate limit detection
- 🔒 **Event Lock with TTL** — Prevents concurrent processing of multiple rate limit events

## Why Choose This Plugin?

Built for people who keep several AI subs active and don't want their coding session to die just because one provider hits a limit. You get a single resilient OpenCode setup that can mix cheap/fast and expensive/high‑quality models without manual switching.

### 🧑‍💻 **Vibe Coding Without Pauses**

Configure multiple providers (Gemini, Anthropic, Z.ai, etc.) and let the plugin seamlessly hop between them whenever one runs into rate limits or concurrency caps.

### 🏗️ **Modular Architecture**

Organized into independent modules (circuitbreaker, config, diagnostics, dynamic, errors, fallback, health, main, metrics, retry, session, utils) for maintainability and testability.

### 🔒 **Event Lock with TTL**

A single session lock with TTL prevents parallel handling of the same rate limit event, eliminating race conditions and redundant fallback attempts.

### ⚡ **Circuit Breaker Pattern**

Full circuit breaker implementation (CLOSED → OPEN → HALF_OPEN) disconnects failing models and tests recovery, preventing repeated failures from the same provider.

### 🔃 **Hot Reload Configuration**

Watches configuration files and reloads settings in real time, with a debounce delay for stability, so you can tweak your fallback setup without restarting OpenCode.

### 🧠 **Dynamic Prioritization**

Auto-reorders models based on a scoring system that considers success rate, response time, and recent usage, keeping the best models at the top over time.

### 🏥 **Health Tracker**

Tracks success rates, response times, and consecutive failures for each model, persists data to disk, and exposes a per‑model health score (0–100) used for smarter selection.

### 📚 **Pattern Learning**

Learns new rate limit patterns from real traffic, improving detection and fallback accuracy without hardcoding every provider message.

### 📊 **Comprehensive Metrics**

Provides console output, optional file storage, and TUI/CLI integration so you can monitor rate limits, fallbacks, retries, and model performance in real time.

### ✅ **Strict Validation & Tests**

A strict ConfigValidator checks configuration integrity before runtime, and the codebase is covered by Vitest-powered unit tests.

## Installation

### Via npm (recommended)

npm install opencode-rate-limit

### Via GitHub

npm install github:zaplakhov/opencode-rate-limit

### From source

git clone https://github.com/zaplakhov/opencode-rate-limit.git
cd opencode-rate-limit
npm install
npm run build

## Quick OpenCode Setup

Add the plugin to your `opencode.json`:

{
  "plugins": ["opencode-rate-limit"]
}

Then create a minimal config (for example at `~/.opencode/rate-limit-fallback.json`):

{
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" },
    { "providerID": "google", "modelID": "gemini-2.5-flash" }
  ]
}

From this point, when one model hits a limit, OpenCode will automatically switch to the next configured one without interrupting your session.

## Connecting to OpenCode (Advanced)

OpenCode will automatically load the plugin on startup once it is listed in `opencode.json`.

Create a configuration file in one of the following locations (in priority order):

1. `<worktree>/.opencode/rate-limit-fallback.json`
2. `<worktree>/rate-limit-fallback.json`
3. `<project>/.opencode/rate-limit-fallback.json`
4. `<project>/rate-limit-fallback.json`
5. `~/.opencode/rate-limit-fallback.json` *(recommended)*
6. `~/.config/opencode/rate-limit-fallback.json`

### Full Configuration

{
  "enabled": true,
  "cooldownMs": 60000,
  "fallbackMode": "cycle",
  "maxSubagentDepth": 10,
  "enableSubagentFallback": true,
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" },
    { "providerID": "google", "modelID": "gemini-2.5-flash" }
  ],
  "retryPolicy": {
    "maxRetries": 3,
    "strategy": "exponential",
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "jitterEnabled": true,
    "jitterFactor": 0.1,
    "timeoutMs": 60000
  },
  "metrics": {
    "enabled": true,
    "output": {
      "console": true,
      "format": "pretty"
    },
    "resetInterval": "daily"
  },
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 5,
    "recoveryTimeoutMs": 60000,
    "halfOpenMaxCalls": 1,
    "successThreshold": 2
  },
  "configReload": {
    "enabled": true,
    "watchFile": true,
    "debounceMs": 1000,
    "notifyOnReload": true
  },
  "dynamicPrioritization": {
    "enabled": true,
    "updateInterval": 10,
    "successRateWeight": 0.6,
    "responseTimeWeight": 0.3,
    "recentUsageWeight": 0.1,
    "minSamples": 3,
    "maxHistorySize": 100
  },
  "enableHealthBasedSelection": true,
  "healthPersistence": {
    "enabled": true,
    "path": "~/.opencode/rate-limit-fallback-health.json"
  }
}

### Fallback Modes

| Mode        | Description                                                 |
|------------|-------------------------------------------------------------|
| `cycle`    | Reset and cycle through all models from first (default).    |
| `stop`     | Stop and show error when all models are exhausted.          |
| `retry-last` | Retry last model, then reset to first.                   |

### Retry Policy

| Parameter       | Type    | Default       | Description                                      |
|-----------------|---------|--------------|--------------------------------------------------|
| `maxRetries`    | number  | `3`          | Maximum number of retry attempts.                |
| `strategy`      | string  | `"immediate"`| Strategy: `immediate`, `exponential`, `linear`.  |
| `baseDelayMs`   | number  | `1000`       | Base delay (ms).                                 |
| `maxDelayMs`    | number  | `30000`      | Maximum delay (ms).                              |
| `jitterEnabled` | boolean | `false`      | Random jitter to prevent thundering herd.        |
| `jitterFactor`  | number  | `0.1`        | Jitter factor (0.1 = ±10%).                      |
| `timeoutMs`     | number  | —            | Overall timeout for all attempts (optional).     |

### Circuit Breaker

| Parameter                          | Type    | Default | Description                                     |
|------------------------------------|---------|---------|-------------------------------------------------|
| `circuitBreaker.enabled`           | boolean | `false` | Enable circuit breaker.                         |
| `circuitBreaker.failureThreshold`  | number  | `5`     | Number of failures before opening circuit.      |
| `circuitBreaker.recoveryTimeoutMs` | number  | `60000` | Time before attempting recovery test.           |
| `circuitBreaker.halfOpenMaxCalls`  | number  | `1`     | Max calls in HALF_OPEN state.                   |
| `circuitBreaker.successThreshold`  | number  | `2`     | Successful calls to close circuit.              |

### Hot Reload

| Parameter                     | Type    | Default | Description                        |
|-------------------------------|---------|---------|------------------------------------|
| `configReload.enabled`        | boolean | `false` | Enable hot reload.                 |
| `configReload.watchFile`      | boolean | `true`  | Watch configuration file.          |
| `configReload.debounceMs`     | number  | `1000`  | Debounce delay (ms).               |
| `configReload.notifyOnReload` | boolean | `true`  | Toast notification on reload.      |

## Metrics System

The plugin collects statistics on rate limits, fallbacks, retries, and model performance, and can expose them via console, TUI, or files.

### Enabling Metrics

{
  "metrics": {
    "enabled": true,
    "output": {
      "console": true,
      "format": "pretty"
    },
    "resetInterval": "daily"
  }
}

### Getting Metrics Data

1. **Console Output** — pretty‑printed blocks in OpenCode logs when `"console": true`.
2. **TUI Integration** — real‑time toasts on rate limits and a `/rate-limit-status` command that returns a detailed Markdown report (overall health, per‑model stats, forecast, fallback statistics).
3. **File Storage** — set `output.file` and `format` (`pretty`, `json`, `csv`) to persist metrics for later analysis.

## Health Tracker

Health Tracker monitors each model and stores a health score used for fallback decisions.

Example persisted data:

{
  "models": {
    "anthropic/claude-sonnet-4-20250514": {
      "healthScore": 85,
      "totalRequests": 150,
      "successfulRequests": 140,
      "failedRequests": 10,
      "averageResponseTime": 1200,
      "lastSuccessTime": 1707600000000,
      "consecutiveFailures": 0
    }
  },
  "lastUpdated": 1707600000000
}

Key parameters include `enableHealthBasedSelection`, `healthPersistence.enabled`, and `healthPersistence.path`, which control whether health is used for selection and whether it is persisted across sessions.

## Diagnostics

Enable verbose mode for detailed insight:

{
  "verbose": true
}

In verbose mode the plugin outputs current config and source file, config merging details, circuit breaker state, health stats, and active fallback operations.

## How It Works

1. **Detection** — Listens to `session.error`, `message.updated`, and `session.status` for rate limit–like errors.
2. **Event Lock** — A single session lock with TTL prevents multiple parallel handlers from acting on the same event.
3. **Abort** — The current session is aborted to stop OpenCode's built‑in retry logic.
4. **Fallback** — The next suitable model is selected according to fallback configuration, health, and metrics.
5. **Cooldown** — Blocked models are temporarily skipped until their cooldown window expires.

## Troubleshooting

### Plugin not performing fallback on rate limit

1. Ensure a configuration file exists and is valid.
2. Check that `fallbackModels` is not empty.
3. Ensure `"enabled": true` in the configuration.
4. Inspect plugin logs or enable `verbose` mode.

### All models running out quickly

1. Add more models to `fallbackModels`.
2. Increase `cooldownMs` to give providers time to recover.
3. Use `fallbackMode: "cycle"` for automatic reset of the pool.
4. Enable `circuitBreaker` to temporarily exclude unstable models.

## License

[MIT](LICENSE)

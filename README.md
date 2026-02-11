# opencode-rate-limit

[![npm version](https://badge.fury.io/js/opencode-rate-limit.svg)](https://www.npmjs.com/package/opencode-rate-limit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

OpenCode plugin that automatically switches to fallback models when rate limit is reached. Built with a modular architecture and comprehensive features for robust AI model fallback management.

## Features

- 🔄 **Automatic Fallback** — Detects rate limit errors (429, "usage limit", "quota exceeded", "high concurrency") and instantly switches to a backup model
- 📋 **Priority-Based Model List** — Configurable fallback order with multiple models
- 🔁 **Three Fallback Modes** — `cycle` (cycling through), `stop` (stop with error), and `retry-last` (retry last model)
- 🤖 **Agent/Mode Preservation** — Maintains current agent context during model switching
- ⏱️ **Cooldown** — Configurable wait period before retrying blocked models
- 📊 **Exponential Backoff** — Strategies: immediate, exponential, linear with jitter
- 🔌 **Subagent Support** — Automatic fallback propagation through session hierarchy
- ⚡ **Circuit Breaker** — Automatic disconnection of consistently failing models
- 📈 **Metrics System** — Detailed statistics on rate limits, fallbacks, retries, and model performance
- 🔃 **Hot Reload** — Configuration reload without restarting OpenCode
- 🧠 **Dynamic Prioritization** — Auto-reordering models based on success rate, response time, and usage frequency
- 🏥 **Health Tracker** — Real-time health monitoring for each model
- 📚 **Pattern Learning** — Self-learning error pattern recognition for rate limit detection
- 🔒 **Event Lock with TTL** — Prevents concurrent processing of multiple rate limit events

## Why Choose This Plugin?

Built with a modern, modular architecture designed specifically for robust AI model fallback management.

### 🏗️ **Modular Architecture**
Organized into 12 independent modules (circuitbreaker, config, diagnostics, dynamic, errors, fallback, health, main, metrics, retry, session, utils) for maintainability and testability.

### 🔒 **Event Lock with TTL**
Prevents concurrent rate limit event processing with a single session lock (10s TTL), eliminating race conditions and redundant fallback attempts.

### ⚡ **Circuit Breaker Pattern**
Full circuit breaker implementation with states: CLOSED → OPEN → HALF_OPEN. Automatically disconnects failing models and tests recovery, preventing repeated failures.

### 🔃 **Hot Reload Configuration**
Monitor configuration files and reload settings in real-time without restarting OpenCode. Debounced with 1-second delay for stability.

### 🧠 **Dynamic Prioritization**
Auto-reorders models based on a scoring system:
```
score = successRate × 0.6 + responseTime × 0.3 + recentUsage × 0.1
```

### 🏥 **Health Tracker**
Real-time health monitoring with persistent storage. Tracks success rates, response times, and consecutive failures for intelligent model selection.

### 📚 **Pattern Learning**
Self-learning system that recognizes new rate limit patterns, improving fallback accuracy over time.

### 📊 **Comprehensive Metrics**
Detailed reporting with console output, file storage, and CLI integration. Monitor rate limits, fallbacks, retries, and model performance in real-time.

### ✅ **Strict Validation**
ConfigValidator with strict mode ensures configuration integrity before runtime.

### 🧪 **Full Test Coverage**
Vitest-powered unit tests with coverage, replacing manual scripts with professional testing.

## Installation

### Via npm (recommended)

```bash
npm install opencode-rate-limit
```

### Via GitHub

```bash
npm install github:zaplakhov/opencode-rate-limit
```

### From source

```bash
git clone https://github.com/zaplakhov/opencode-rate-limit.git
cd opencode-rate-limit
npm install
npm run build
```

### Connecting to OpenCode

Add the plugin to your `opencode.json`:

```json
{
  "plugins": ["opencode-rate-limit"]
}
```

OpenCode will automatically load the plugin on startup.

Create a configuration file in one of the following locations (in priority order):

1. `<worktree>/.opencode/rate-limit-fallback.json`
2. `<worktree>/rate-limit-fallback.json`
3. `<project>/.opencode/rate-limit-fallback.json`
4. `<project>/rate-limit-fallback.json`
5. `~/.opencode/rate-limit-fallback.json` *(recommended)*
6. `~/.config/opencode/rate-limit-fallback.json`

### Minimal Configuration

```json
{
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" }
  ]
}
```

### Full Configuration

```json
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
  }
}
```

### Fallback Modes

| Mode | Description |
|------|-------------|
| `cycle` | Reset and cycle through all models from first (default) |
| `stop` | Stop and show error when all models are exhausted |
| `retry-last` | Retry last model, then reset to first |

### Retry Policy

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxRetries` | number | `3` | Maximum number of retry attempts |
| `strategy` | string | `"immediate"` | Strategy: `immediate`, `exponential`, `linear` |
| `baseDelayMs` | number | `1000` | Base delay (ms) |
| `maxDelayMs` | number | `30000` | Maximum delay (ms) |
| `jitterEnabled` | boolean | `false` | Random jitter to prevent thundering herd |
| `jitterFactor` | number | `0.1` | Jitter factor (0.1 = ±10%) |
| `timeoutMs` | number | — | Overall timeout for all attempts (optional) |

### Circuit Breaker

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `circuitBreaker.enabled` | boolean | `false` | Enable circuit breaker |
| `circuitBreaker.failureThreshold` | number | `5` | Number of failures before opening circuit |
| `circuitBreaker.recoveryTimeoutMs` | number | `60000` | Time before attempting recovery test |
| `circuitBreaker.halfOpenMaxCalls` | number | `1` | Max calls in HALF_OPEN state |
| `circuitBreaker.successThreshold` | number | `2` | Successful calls to close circuit |

### Hot Reload

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `configReload.enabled` | boolean | `false` | Enable hot reload |
| `configReload.watchFile` | boolean | `true` | Watch configuration file |
| `configReload.debounceMs` | number | `1000` | Debounce delay (ms) |
| `configReload.notifyOnReload` | boolean | `true` | Toast notification on reload |

## Metrics System

The plugin collects statistics on rate limits, fallbacks, retries, and model performance. Configure output settings to view data.

### Enabling Metrics

```json
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
```

### Getting Metrics Data

#### 1. Console Output

When `"console": true`, metrics are periodically output to OpenCode logs. Example output in `pretty` format:

```
============================================================
Rate Limit Fallback Metrics
============================================================
Started: 2026-02-11T10:00:00.000Z

Rate Limits:
  anthropic/claude-sonnet-4-20250514:
    Count: 5
    Avg Interval: 3.50s

Fallbacks:
  Total: 3 | Successful: 2 | Failed: 1
  Avg Duration: 1.25s

Model Performance:
  google/gemini-2.5-pro:
    Requests: 10 | Success Rate: 90.0%
    Avg Response: 0.85s
============================================================
```

#### 2. TUI Integration (New in v1.1.0)

The plugin is deeply integrated with OpenCode TUI for convenient real-time monitoring.

##### Automatic Notifications (Toasts)
When a Rate Limit occurs or the plugin switches to a fallback model, it displays a toast notification with details:
- **Health Score**: Current health of the primary model (0-100).
- **Request Counter**: Number of successful requests since last blockage.
- **Transition Model**: Which model is being switched to.

##### Command `/rate-limit-status`
You can request a full metrics status report at any time via AI or by entering a command (if the client supports it). This tool returns a detailed Markdown report:
- Overall health of all monitored models.
- Number of failures and successful requests for each model.
- **Forecast**: Estimated number of requests until next blockage based on accumulated statistics.
- Fallback statistics (number of switches, average duration).

#### 3. File Storage

Specify a path in `"output.file"` for automatic saving:

```json
{
  "metrics": {
    "enabled": true,
    "output": {
      "console": false,
      "file": "~/.opencode/metrics.json",
      "format": "json"
    }
  }
}
```

The file is updated automatically. Available formats: `pretty` (text), `json`, `csv`.

#### 3. Reset Interval

| Value | Description |
|-------|-------------|
| `"hourly"` | Reset metrics every hour |
| `"daily"` | Reset once per day (default) |
| `"weekly"` | Reset once per week |

## Health Tracker

Health Tracker monitors the health of each model based on success rate and response time. Data is used for intelligent fallback model selection.

### Enabling

```json
{
  "enableHealthBasedSelection": true,
  "healthPersistence": {
    "enabled": true,
    "path": "~/.opencode/rate-limit-fallback-health.json"
  }
}
```

### Viewing Data

Health Tracker automatically saves data to a JSON file at the specified path (default `~/.opencode/rate-limit-fallback-health.json`). The file contains:

```json
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
    },
    "google/gemini-2.5-pro": {
      "healthScore": 95,
      "totalRequests": 80,
      "successfulRequests": 78,
      "failedRequests": 2,
      "averageResponseTime": 850
    }
  },
  "lastUpdated": 1707600000000
}
```

### Health Tracker Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enableHealthBasedSelection` | boolean | `false` | Use health score for model selection |
| `healthPersistence.enabled` | boolean | `true` | Persist data between sessions |
| `healthPersistence.path` | string | `~/.opencode/rate-limit-fallback-health.json` | Path to data file |
| `healthPersistence.responseTimeThreshold` | number | `2000` | Response time threshold (ms) |
| `healthPersistence.minRequestsForReliableScore` | number | `3` | Min requests for reliable score |

### Health Score Calculation

Each model receives a score from 0 to 100:
- **Base score** = `(successfulRequests / totalRequests) × 100`
- **Response time penalty** = if `avgResponseTime > 2000ms`, subtract `(avgResponseTime - 2000) / 200` points
- **Failure penalty** = subtract `consecutiveFailures × 15` points

## Diagnostics

For detailed plugin operation information, enable verbose mode:

```json
{
  "verbose": true
}
```

In verbose mode, the plugin outputs:
- Current configuration and file source
- Configuration merge details (changes from defaults)
- Circuit Breaker status for each model
- Health Tracker statistics
- Active fallback operations

## How It Works

1. **Detection** — Plugin listens for rate limit events via `session.error`, `message.updated`, and `session.status`
2. **Event Lock** — Single session lock (10s TTL) prevents multiple parallel processing of the same error
3. **Abort** — Current session is aborted to stop OpenCode's internal retry mechanism
4. **Fallback** — Next available model is selected from the fallback list
5. **Cooldown** — Blocked models are skipped for the configured period

## Troubleshooting

### Plugin not performing fallback on rate limit

1. Ensure configuration file exists and is valid
2. Check that `fallbackModels` is not empty
3. Ensure `enabled: true`
4. Check plugin logs

### All models running out quickly

1. Add more models to `fallbackModels`
2. Increase `cooldownMs`
3. Use `fallbackMode: "cycle"` for automatic reset
4. Enable `circuitBreaker` to filter out unstable models



## License

[MIT](LICENSE)

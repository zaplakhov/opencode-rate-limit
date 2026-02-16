/**
 * Default configuration constants
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

// ============================================================================
// OpenCode Database Defaults
// ============================================================================

/**
 * Primary default path to OpenCode SQLite database
 * This matches the actual OpenCode installation location
 */
export const DEFAULT_OPENCODE_DB_PATH = join(homedir(), '.opencode', 'data', 'opencode.db');

/**
 * Legacy default path to OpenCode SQLite database
 * Used as fallback for backward compatibility
 */
export const LEGACY_OPENCODE_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

/**
 * Resolve OpenCode database path with automatic detection
 *
 * This function tries to find the OpenCode database by checking:
 * 1. Primary path: ~/.opencode/data/opencode.db (current OpenCode location)
 * 2. Fallback path: ~/.local/share/opencode/opencode.db (legacy location)
 *
 * If the database is not found at either location, returns undefined.
 *
 * @param customPath - Optional custom path to check first
 * @returns Resolved database path or undefined if not found
 *
 * @example
 * ```typescript
 * const dbPath = resolveOpenCodeDbPath();
 * if (dbPath) {
 *   console.log(`Using database at: ${dbPath}`);
 * } else {
 *   console.warn('OpenCode database not found');
 * }
 * ```
 */
export function resolveOpenCodeDbPath(customPath?: string): string | undefined {
  // If custom path is provided, check if it exists
  if (customPath) {
    if (existsSync(customPath)) {
      return customPath;
    }
    // Custom path doesn't exist, fall through to auto-detection
  }

  // Check primary path (current OpenCode location)
  if (existsSync(DEFAULT_OPENCODE_DB_PATH)) {
    return DEFAULT_OPENCODE_DB_PATH;
  }

  // Check legacy path for backward compatibility
  if (existsSync(LEGACY_OPENCODE_DB_PATH)) {
    return LEGACY_OPENCODE_DB_PATH;
  }

  // Database not found
  return undefined;
}

/**
 * Default time window for statistics (30 days)
 */
export const DEFAULT_OPENCODE_DB_WINDOW_DAYS = 30;

/**
 * Default OpenCode database configuration
 */
export const DEFAULT_OPENCODE_DB_CONFIG = {
  dbPath: DEFAULT_OPENCODE_DB_PATH,
  windowDays: DEFAULT_OPENCODE_DB_WINDOW_DAYS,
} as const;

// ============================================================================
// Health Tracker Defaults
// ============================================================================

/**
 * Default health persistence path
 */
export const DEFAULT_HEALTH_PERSISTENCE_PATH = join(homedir(), '.opencode', 'rate-limit-fallback-health.json');

/**
 * Default health tracker configuration
 */
export const DEFAULT_HEALTH_TRACKER_CONFIG = {
  enabled: true,
  path: DEFAULT_HEALTH_PERSISTENCE_PATH,
  responseTimeThreshold: 2000,          // ms - threshold for response time penalty
  responseTimePenaltyDivisor: 200,      // divisor for response time penalty calculation
  failurePenaltyMultiplier: 15,        // penalty per consecutive failure
  minRequestsForReliableScore: 3,       // min requests before score is reliable
} as const;

// ============================================================================
// Plugin Defaults
// ============================================================================

/**
 * Default cooldown period (ms)
 */
export const DEFAULT_COOLDOWN_MS = 60 * 1000;

/**
 * Default fallback mode
 */
export const DEFAULT_FALLBACK_MODE = "cycle" as const;

// ============================================================================
// Logging Defaults
// ============================================================================

/**
 * Default log configuration
 */
export const DEFAULT_LOG_CONFIG = {
  level: "warn" as const,
  format: "simple" as const,
  enableTimestamp: true,
} as const;

// ============================================================================
// Metrics Defaults
// ============================================================================

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_CONFIG = {
  enabled: false,
  output: {
    console: true,
    format: "pretty" as const,
  } as const,
  resetInterval: "daily" as const,
} as const;

// ============================================================================
// Config Reload Defaults
// ============================================================================

/**
 * Default config reload configuration
 */
export const DEFAULT_CONFIG_RELOAD_CONFIG = {
  enabled: false,
  watchFile: true,
  debounceMs: 1000,
  notifyOnReload: true,
} as const;

// ============================================================================
// Dynamic Prioritization Defaults
// ============================================================================

/**
 * Default dynamic prioritization configuration
 */
export const DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG = {
  enabled: false,
  updateInterval: 10,
  successRateWeight: 0.6,
  responseTimeWeight: 0.3,
  recentUsageWeight: 0.1,
  minSamples: 3,
  maxHistorySize: 100,
} as const;

// ============================================================================
// Error Pattern Configuration Defaults
// ============================================================================

/**
 * Default pattern learning configuration
 */
export const DEFAULT_PATTERN_LEARNING_CONFIG = {
  enabled: false,
  autoApproveThreshold: 0.8,
  maxLearnedPatterns: 20,
  minErrorFrequency: 3,
  learningWindowMs: 86400000, // 24 hours
} as const;

/**
 * Default error pattern configuration
 */
export const DEFAULT_ERROR_PATTERNS_CONFIG = {
  custom: undefined,
  enableLearning: false,
  autoApproveThreshold: 0.8,
  maxLearnedPatterns: 20,
  minErrorFrequency: 3,
  learningWindowMs: 86400000,
} as const;

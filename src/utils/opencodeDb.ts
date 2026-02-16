/**
 * Module: opencodeDb
 * Role: Read statistics from OpenCode SQLite database
 * Source of Truth: This module implements direct SQLite queries to OpenCode database
 *
 * Uses:
 *   bun:sqlite:Database: Database connection
 *   bun:sqlite:Statement: Prepared SQL statements
 *   fs:existsSync: Check if database file exists
 *
 * Used by:
 *   tui:StatusReporter:getFullReport: true
 *
 * Glossary: ai/glossary/ai-usage.md
 */

// @ts-ignore - bun:sqlite types are built-in to Bun runtime
import { Database } from 'bun:sqlite';
import type {
  ModelUsageStats,
  OpenCodeDbConfig,
  OpenCodeDbResult
} from '../types/index.js';
import {
  DEFAULT_OPENCODE_DB_CONFIG,
  resolveOpenCodeDbPath,
  DEFAULT_OPENCODE_DB_PATH,
  LEGACY_OPENCODE_DB_PATH,
} from '../config/defaults.js';

/**
 * Calculate window start timestamp based on days
 *
 * @param windowDays - Number of days to look back
 * @returns Unix timestamp in seconds
 */
function calculateWindowStart(windowDays: number): number {
  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return Math.floor((now - windowMs) / 1000); // Convert to seconds for Unix timestamp
}

/**
 * Read model usage statistics from OpenCode database
 *
 * This function performs the following operations:
 * 1. Checks if the database file exists
 * 2. Opens the database in read-only mode
 * 3. Executes a query to aggregate message statistics by provider and model
 * 4. Closes the database connection
 * 5. Returns the statistics or an error
 *
 * The query aggregates:
 * - Total message count
 * - Input tokens
 * - Output tokens
 * - Cache read tokens
 * - Cache write tokens
 *
 * Only messages with role 'user' or 'assistant' are included.
 *
 * @param config - Database configuration (optional, uses defaults if not provided)
 * @returns Query result containing success status, statistics array, and optional error
 *
 * @example
 * ```typescript
 * const result = readModelUsageStats();
 * if (result.success) {
 *   console.log(`Found stats for ${result.stats.length} models`);
 *   for (const stat of result.stats) {
 *     console.log(`${stat.providerID}/${stat.modelID}: ${stat.messages} messages`);
 *   }
 * } else {
 *   console.error(`Failed to read stats: ${result.error}`);
 * }
 * ```
 */
export function readModelUsageStats(config?: OpenCodeDbConfig): OpenCodeDbResult {
  const finalConfig = { ...DEFAULT_OPENCODE_DB_CONFIG, ...config };

  // Resolve database path with automatic detection
  const resolvedDbPath = resolveOpenCodeDbPath(finalConfig.dbPath);
  const { windowDays } = finalConfig;

  // If database not found, return error with helpful message
  if (!resolvedDbPath) {
    const error = `OpenCode database not found. Tried: ${DEFAULT_OPENCODE_DB_PATH} (primary), ${finalConfig.dbPath === DEFAULT_OPENCODE_DB_PATH ? LEGACY_OPENCODE_DB_PATH : finalConfig.dbPath} (legacy)`;
    console.warn(`[opencodeDb] ${error}`);
    return {
      success: false,
      stats: [],
      error,
    };
  }

  let db: Database | null = null;

  try {
    // Open database in read-only mode for safety
    db = new Database(resolvedDbPath, { readonly: true });

    // Calculate window start timestamp
    const windowStart = calculateWindowStart(windowDays);

    // Prepare query with parameterized input to prevent SQL injection
    const query = `
      SELECT
        providerID,
        modelID,
        COUNT(*) as messages,
        SUM(json_extract(data, '$.tokens.input')) as inputTokens,
        SUM(json_extract(data, '$.tokens.output')) as outputTokens,
        SUM(json_extract(data, '$.tokens.cache.read')) as cacheRead,
        SUM(json_extract(data, '$.tokens.cache.write')) as cacheWrite
      FROM message
      WHERE role IN ('user', 'assistant')
        AND json_extract(data, '$.time.created') >= ?
      GROUP BY providerID, modelID
    `;

    const stmt = db.query(query);
    const rows = stmt.all(windowStart) as Array<{
      providerID: string;
      modelID: string;
      messages: number;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheRead: number | null;
      cacheWrite: number | null;
    }>;

    // Convert database rows to ModelUsageStats, handling null values
    const stats: ModelUsageStats[] = rows.map(row => ({
      providerID: row.providerID,
      modelID: row.modelID,
      messages: row.messages,
      inputTokens: row.inputTokens || 0,
      outputTokens: row.outputTokens || 0,
      cacheRead: row.cacheRead || 0,
      cacheWrite: row.cacheWrite || 0,
    }));

    return {
      success: true,
      stats,
    };
  } catch (error) {
    // Safe degradation: return empty stats on error
    return {
      success: false,
      stats: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Ensure database is always closed
    if (db) {
      db.close();
    }
  }
}


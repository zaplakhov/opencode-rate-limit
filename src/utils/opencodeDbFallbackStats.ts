/**
 * Module: opencodeDbFallbackStats
 * Role: Read fallback statistics from OpenCode SQLite database using heuristic analysis
 * Source of Truth: This module implements heuristic-based analysis of message sequences for fallbacks
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
  FallbackStatsResult,
  FallbackStatsDb,
  OpenCodeDbConfig,
} from '../types/index.js';
import {
  DEFAULT_OPENCODE_DB_CONFIG,
  resolveOpenCodeDbPath,
  DEFAULT_OPENCODE_DB_PATH,
  LEGACY_OPENCODE_DB_PATH,
} from '../config/defaults.js';
import {
  hasRateLimitError,
  calculateWindowStart,
  type MessageData,
} from './opencodeDbHelpers.js';

/**
 * Read fallback statistics from OpenCode database
 *
 * This function identifies fallback attempts by analyzing retry sequences:
 * 1. Uses the same logic as readRetryStats() to find retry pairs
 * 2. Checks if the retry attempt used a different providerID or modelID
 * 3. Treats model changes as fallback attempts
 * 4. Aggregates fallback statistics by source and target models
 *
 * The query performs the following operations:
 * 1. Checks if the database file exists
 * 2. Opens the database in read-only mode
 * 3. Finds message pairs with same sessionID and parentID
 * 4. Filters for messages with rate limit errors
 * 5. Identifies fallbacks when providerID or modelID differs
 * 6. Aggregates fallback statistics by source and target models
 * 7. Returns the statistics or an error
 *
 * @param config - Database configuration (optional, uses defaults if not provided)
 * @returns Query result containing success status, fallback statistics, and optional error
 *
 * @example
 * ```typescript
 * const result = readFallbackStats();
 * if (result.success) {
 *   console.log(`Found ${result.stats.totalFallbacks} fallbacks`);
 *   for (const [sourceModel, data] of result.stats.bySourceModel.entries()) {
 *     console.log(`${sourceModel} → ${data.targetModel}: ${data.count} times`);
 *   }
 * }
 * ```
 */
export function readFallbackStats(config?: OpenCodeDbConfig): FallbackStatsResult {
  const finalConfig = { ...DEFAULT_OPENCODE_DB_CONFIG, ...config };

  // Resolve database path with automatic detection
  const resolvedDbPath = resolveOpenCodeDbPath(finalConfig.dbPath);
  const { windowDays } = finalConfig;

  // If database not found, return error with helpful message
  if (!resolvedDbPath) {
    const error = `OpenCode database not found. Tried: ${DEFAULT_OPENCODE_DB_PATH} (primary), ${finalConfig.dbPath === DEFAULT_OPENCODE_DB_PATH ? LEGACY_OPENCODE_DB_PATH : finalConfig.dbPath} (legacy)`;
    console.warn(`[opencodeDbFallbackStats] ${error}`);
    return {
      success: false,
      stats: { totalFallbacks: 0, bySourceModel: new Map(), byTargetModel: new Map() },
      error,
    };
  }

  let db: Database | null = null;

  try {
    // Open database in read-only mode for safety
    db = new Database(resolvedDbPath, { readonly: true });

    // Calculate window start timestamp
    const windowStart = calculateWindowStart(windowDays);

    // Query to find all message sequences with same sessionID and parentID
    // This returns all messages in sequences, not pairs
    const query = `
      SELECT
        id,
        sessionID,
        parentID,
        role,
        providerID,
        modelID,
        data
      FROM message
      WHERE role IN ('user', 'assistant')
        AND json_extract(data, '$.time.created') >= ?
      ORDER BY sessionID, parentID, id
    `;

    const stmt = db.query(query);
    const rows = stmt.all(windowStart) as Array<{
      id: string;
      sessionID: string;
      parentID: string;
      role: string;
      providerID: string;
      modelID: string;
      data: string;
    }>;

    // Analyze message sequences to identify fallbacks
    const fallbackStats: FallbackStatsDb = {
      totalFallbacks: 0,
      bySourceModel: new Map(),
      byTargetModel: new Map(),
    };

    // Group by session and parent to analyze sequences
    const sequences = new Map<string, typeof rows>();

    for (const row of rows) {
      const key = `${row.sessionID}:${row.parentID}`;
      if (!sequences.has(key)) {
        sequences.set(key, []);
      }
      sequences.get(key)!.push(row);
    }

    // Analyze each sequence for fallbacks
    for (const messages of sequences.values()) {
      if (messages.length < 2) continue;

      // Process consecutive pairs to identify fallbacks
      for (let i = 0; i < messages.length - 1; i++) {
        const first = messages[i];
        const second = messages[i + 1];

        // Parse data fields to get content
        let firstData: MessageData;

        try {
          firstData = JSON.parse(first.data);
        } catch (e) {
          continue;
        }

        // Check if first message has rate limit error
        const hasError =
          (firstData.status === 'error' || firstData.status === 'failed') ||
          (firstData.error && hasRateLimitError(typeof firstData.error === 'string' ? firstData.error : JSON.stringify(firstData.error))) ||
          (firstData.content && hasRateLimitError(typeof firstData.content === 'string' ? firstData.content : JSON.stringify(firstData.content)));

        if (!hasError) continue;

        // Check if this is a fallback (different provider or model)
        const isFallback =
          first.providerID !== second.providerID ||
          first.modelID !== second.modelID;

        if (!isFallback) continue;

        // This is a fallback
        fallbackStats.totalFallbacks++;

        const sourceKey = `${first.providerID}/${first.modelID}`;
        const targetKey = `${second.providerID}/${second.modelID}`;

        // Update bySourceModel
        const existingSource = fallbackStats.bySourceModel.get(sourceKey);
        if (existingSource) {
          existingSource.count++;
        } else {
          fallbackStats.bySourceModel.set(sourceKey, { count: 1, targetModel: targetKey });
        }

        // Update byTargetModel
        const existingTarget = fallbackStats.byTargetModel.get(targetKey);
        if (existingTarget) {
          existingTarget.usedAsFallback++;
        } else {
          fallbackStats.byTargetModel.set(targetKey, { usedAsFallback: 1 });
        }
      }
    }

    return {
      success: true,
      stats: fallbackStats,
    };
  } catch (error) {
    // Safe degradation: return empty stats on error
    return {
      success: false,
      stats: { totalFallbacks: 0, bySourceModel: new Map(), byTargetModel: new Map() },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Ensure database is always closed
    if (db) {
      db.close();
    }
  }
}

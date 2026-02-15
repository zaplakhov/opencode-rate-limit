/**
 * Module: opencodeDbRetryStats
 * Role: Read retry statistics from OpenCode SQLite database using heuristic analysis
 * Source of Truth: This module implements heuristic-based analysis of message sequences for retries
 *
 * Uses:
 *   better-sqlite3:Database: Database connection
 *   better-sqlite3:Statement: Prepared SQL statements
 *   fs:existsSync: Check if database file exists
 *
 * Used by:
 *   tui:StatusReporter:getFullReport: true
 *
 * Glossary: ai/glossary/ai-usage.md
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import type {
  RetryStatsResult,
  RetryStatsDb,
  OpenCodeDbConfig,
} from '../types/index.js';
import {
  DEFAULT_OPENCODE_DB_CONFIG,
} from '../config/defaults.js';
import {
  hasRateLimitError,
  calculateWindowStart,
  type MessageData,
} from './opencodeDbHelpers.js';

/**
 * Read retry statistics from OpenCode database
 *
 * This function identifies retry attempts by analyzing message sequences:
 * 1. Finds pairs of messages with the same parentID in the same session
 * 2. First message has error/rate-limit pattern in its content
 * 3. Second message is treated as a retry attempt
 * 4. Both messages must have role 'user' or 'assistant'
 *
 * The query performs the following operations:
 * 1. Checks if the database file exists
 * 2. Opens the database in read-only mode
 * 3. Finds message pairs with same sessionID and parentID
 * 4. Filters for messages with rate limit errors
 * 5. Aggregates retry statistics by model
 * 6. Returns the statistics or an error
 *
 * @param config - Database configuration (optional, uses defaults if not provided)
 * @returns Query result containing success status, retry statistics, and optional error
 *
 * @example
 * ```typescript
 * const result = readRetryStats();
 * if (result.success) {
 *   console.log(`Found ${result.stats.totalRetries} retries`);
 *   for (const [modelID, stats] of result.stats.byModel.entries()) {
 *     console.log(`${modelID}: ${stats.attempts} attempts, ${stats.successful} successful`);
 *   }
 * }
 * ```
 */
export function readRetryStats(config?: OpenCodeDbConfig): RetryStatsResult {
  const finalConfig = { ...DEFAULT_OPENCODE_DB_CONFIG, ...config };
  const { dbPath, windowDays } = finalConfig;

  // Check if database file exists - safe degradation
  if (!existsSync(dbPath)) {
    return {
      success: false,
      stats: { totalRetries: 0, byModel: new Map() },
      error: `Database file not found: ${dbPath}`,
    };
  }

  let db: Database.Database | null = null;

  try {
    // Open database in read-only mode for safety
    db = new Database(dbPath, { readonly: true });

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

    const stmt = db.prepare(query);
    const rows = stmt.all(windowStart) as Array<{
      id: string;
      sessionID: string;
      parentID: string;
      role: string;
      providerID: string;
      modelID: string;
      data: string;
    }>;

    // Analyze message sequences to identify retries
    const retryStats: RetryStatsDb = {
      totalRetries: 0,
      byModel: new Map(),
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

    // Analyze each sequence for retries
    for (const messages of sequences.values()) {
      if (messages.length < 2) continue;

      // Process consecutive pairs to identify retries
      for (let i = 0; i < messages.length - 1; i++) {
        const first = messages[i];
        const second = messages[i + 1];

        // Parse data fields to get content
        let firstData: MessageData;
        let secondData: MessageData; // только в retryStats

        try {
          firstData = JSON.parse(first.data);
          secondData = JSON.parse(second.data);
        } catch (e) {
          continue;
        }

        // Check if first message has rate limit error
        // Look for error in status, content, or error field
        const hasError =
          (firstData.status === 'error' || firstData.status === 'failed') ||
          (firstData.error && hasRateLimitError(typeof firstData.error === 'string' ? firstData.error : JSON.stringify(firstData.error))) ||
          (firstData.content && hasRateLimitError(typeof firstData.content === 'string' ? firstData.content : JSON.stringify(firstData.content)));

        if (!hasError) continue;

        // This is a retry - second message is the retry attempt
        retryStats.totalRetries++;

        // Count by the model that was retried
        const modelKey = `${first.providerID}/${first.modelID}`;
        const existing = retryStats.byModel.get(modelKey) || { attempts: 0, successful: 0 };
        existing.attempts++;

        // Check if retry was successful (retry message has success status)
        const retrySuccessful =
          secondData.status === 'success' ||
          secondData.status === 'completed' ||
          (!secondData.error && secondData.content);

        if (retrySuccessful) {
          existing.successful++;
        }

        retryStats.byModel.set(modelKey, existing);
      }
    }

    return {
      success: true,
      stats: retryStats,
    };
  } catch (error) {
    // Safe degradation: return empty stats on error
    return {
      success: false,
      stats: { totalRetries: 0, byModel: new Map() },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Ensure database is always closed
    if (db) {
      db.close();
    }
  }
}

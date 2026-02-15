/**
 * Module: opencodeDbHelpers
 * Role: Shared utilities for OpenCode Database operations
 *
 * Uses:
 *   opencodeDb:readModelUsageStats: Calculate window start timestamp
 *   opencodeDbRetryStats:readRetryStats: Rate limit pattern detection
 *   opencodeDbFallbackStats:readFallbackStats: Rate limit pattern detection
 *
 * Used by:
 *   opencodeDb:readModelUsageStats: true
 *   opencodeDbRetryStats:readRetryStats: true
 *   opencodeDbFallbackStats:readFallbackStats: true
 *
 * Glossary: ai/glossary/ai-usage.md
 */

/**
 * Rate limit error patterns for detection
 */
export const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'usage limit',
  'high concurrency',
  'quota exceeded',
  '429',
] as const;

/**
 * Check if content contains any rate limit error pattern
 */
export function hasRateLimitError(content: string | null): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return RATE_LIMIT_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Message data structure from SQLite JSON
 */
export interface MessageData {
  status?: string;
  error?: unknown;
  content?: string;
  time?: { created?: number };
}

/**
 * Calculate window start timestamp based on days
 *
 * @param windowDays - Number of days to look back
 * @returns Unix timestamp in seconds
 */
export function calculateWindowStart(windowDays: number): number {
  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return Math.floor((now - windowMs) / 1000);
}

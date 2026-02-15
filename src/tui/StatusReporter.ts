/**
 * Module: StatusReporter
 * Role: Format and display metrics to OpenCode TUI using SQLite global stats
 * Source of Truth: This module generates markdown reports combining SQLite and MetricsManager data
 *
 * Uses:
 *   opencodeDb:readModelUsageStats: Read global model statistics from SQLite DB
 *   opencodeDb:readRetryStats: Read retry statistics from SQLite DB
 *   opencodeDb:readFallbackStats: Read fallback statistics from SQLite DB
 *   metrics/MetricsManager:MetricsManager: Get fallback and retry metrics
 *   health/HealthTracker:HealthTracker: Get model health scores
 *   utils/helpers:getModelKey: Generate model key for lookups
 *   utils/helpers:safeShowToast: Show toast notifications safely
 *
 * Used by:
 *   fallback:FallbackHandler:FallbackHandler: true
 *
 * Glossary: ai/glossary/ai-usage.md
 */

import type { OpenCodeClient, PluginConfig } from '../types/index.js';
import type { Logger } from '../../logger.js';
import type { MetricsManager } from '../metrics/MetricsManager.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import { safeShowToast, getModelKey } from '../utils/helpers.js';
import { readModelUsageStats } from '../utils/opencodeDb.js';
import { readRetryStats } from '../utils/opencodeDbRetryStats.js';
import { readFallbackStats } from '../utils/opencodeDbFallbackStats.js';
import { DEFAULT_OPENCODE_DB_CONFIG } from '../config/defaults.js';

export class StatusReporter {
    private client: OpenCodeClient;
    private metrics: MetricsManager;
    private health: HealthTracker;

    // Track requests since last rate limit per model
    private requestsSinceLastRateLimit: Map<string, number> = new Map();

    constructor(
        client: OpenCodeClient,
        _config: PluginConfig,
        _logger: Logger,
        metrics: MetricsManager,
        health: HealthTracker
    ) {
        this.client = client;
        this.metrics = metrics;
        this.health = health;
    }

    /**
     * Record a request for a model to update local counters
     */
    recordRequest(providerID: string, modelID: string): void {
        const key = getModelKey(providerID, modelID);
        const count = this.requestsSinceLastRateLimit.get(key) || 0;
        this.requestsSinceLastRateLimit.set(key, count + 1);
    }

    /**
     * Reset request count for a model (called on rate limit)
     */
    resetCount(providerID: string, modelID: string): void {
        const key = getModelKey(providerID, modelID);
        this.requestsSinceLastRateLimit.set(key, 0);
    }

    /**
     * Calculate prediction for how many requests remain until next rate limit
     */
    private predictRemainingRequests(providerID: string, modelID: string): number | null {
        const key = getModelKey(providerID, modelID);
        const metricsData = this.metrics.getMetrics();
        const modelMetrics = metricsData.rateLimits.get(key);

        if (!modelMetrics || modelMetrics.count === 0) return null;

        // Simple prediction: average requests between rate limits
        // We need total requests for this model / rate limit count
        const totalRequests = metricsData.modelPerformance.get(key)?.requests || 0;
        const avgRequestsPerLimit = Math.floor(totalRequests / (modelMetrics.count + 1));

        const current = this.requestsSinceLastRateLimit.get(key) || 0;
        return Math.max(0, avgRequestsPerLimit - current);
    }

    /**
     * Show a toast notification about rate limit and fallback
     */
    async showRateLimitToast(
        providerID: string,
        modelID: string,
        fallbackProviderID?: string,
        fallbackModelID?: string
    ): Promise<void> {
        if (!this.client.tui) return;

        const healthScore = this.health.getHealthScore(providerID, modelID);
        const requests = this.requestsSinceLastRateLimit.get(getModelKey(providerID, modelID)) || 0;

        let message = `🏥 Health: ${healthScore}/100\n📊 Запросов: ${requests}`;

        if (fallbackProviderID && fallbackModelID) {
            message += `\n🔄 Fallback: → ${fallbackModelID}`;
        }

        await safeShowToast(this.client, {
            body: {
                title: `⚠️ Rate Limit: ${modelID}`,
                message,
                variant: "warning",
                duration: 5000
            }
        });

        this.resetCount(providerID, modelID);
    }

    /**
     * Show a toast with health info for a model
     */
    async showHealthToast(providerID: string, modelID: string): Promise<void> {
        if (!this.client.tui) return;

        const healthScore = this.health.getHealthScore(providerID, modelID);
        const remaining = this.predictRemainingRequests(providerID, modelID);

        let message = `🏥 Health: ${healthScore}/100`;
        if (remaining !== null) {
            message += `\n⏱ Прогноз: ~${remaining} запросов`;
        }

        await safeShowToast(this.client, {
            body: {
                title: `📈 Model Status: ${modelID}`,
                message,
                variant: "info",
                duration: 3000
            }
        });
    }

    /**
     * Generate a full markdown report for metrics
     * Combines global SQLite statistics with fallback and retry metrics from MetricsManager
     * and heuristic-based retry/fallback stats from SQLite
     */
    getFullReport(): string {
        const metricsData = this.metrics.getMetrics();
        const healthStats = this.health.getStats();

        // Read global statistics from SQLite
        const dbResult = readModelUsageStats(DEFAULT_OPENCODE_DB_CONFIG);

        // Read retry stats from SQLite (heuristic-based)
        const retryDbResult = readRetryStats(DEFAULT_OPENCODE_DB_CONFIG);

        // Read fallback stats from SQLite (heuristic-based)
        const fallbackDbResult = readFallbackStats(DEFAULT_OPENCODE_DB_CONFIG);

        let report = `# 📊 Rate Limit Fallback Status\n\n`;

        // Show warning if DB read failed (safe degradation)
        if (!dbResult.success) {
            report += `> ⚠️ **Предупреждение**: Не удалось прочитать глобальную статистику из OpenCode DB\n`;
            report += `> \`${dbResult.error}\`\n\n`;
        }

        // Calculate global aggregates from SQLite
        const totalMessages = dbResult.stats.reduce((sum, stat) => sum + stat.messages, 0);
        const totalInputTokens = dbResult.stats.reduce((sum, stat) => sum + stat.inputTokens, 0);
        const totalOutputTokens = dbResult.stats.reduce((sum, stat) => sum + stat.outputTokens, 0);
        const totalCacheTokens = dbResult.stats.reduce((sum, stat) => sum + stat.cacheRead + stat.cacheWrite, 0);

        // MODEL USAGE section
        report += `## 📊 MODEL USAGE (SQLite)\n`;
        if (dbResult.stats.length === 0) {
            report += `Нет данных о запросах\n\n`;
        } else {
            report += `- Всего сообщений: ${totalMessages}\n`;
            report += `- Input tokens: ${totalInputTokens.toLocaleString()}\n`;
            report += `- Output tokens: ${totalOutputTokens.toLocaleString()}\n`;
            if (totalCacheTokens > 0) {
                report += `- Cache tokens: ${totalCacheTokens.toLocaleString()}\n`;
            }
            report += `- Уникальных моделей: ${dbResult.stats.length}\n\n`;

            report += `| Модель | Сообщения | Input Tokens | Output Tokens | Cache Tokens |\n`;
            report += `| :--- | :---: | :---: | :---: | :---: |\n`;

            // Sort by message count descending
            const sortedStats = [...dbResult.stats].sort((a, b) => b.messages - a.messages);
            for (const stat of sortedStats) {
                const totalCache = stat.cacheRead + stat.cacheWrite;
                report += `| ${stat.modelID} | ${stat.messages} | ${stat.inputTokens.toLocaleString()} | ${stat.outputTokens.toLocaleString()} | ${totalCache.toLocaleString()} |\n`;
            }
            report += `\n`;
        }

        // RETRIES section - combine MetricsManager and SQLite heuristic stats
        report += `## 🔁 RETRIES\n`;

        const hasMetricsRetries = metricsData.retries.total > 0;
        const hasDbRetries = retryDbResult.success && retryDbResult.stats.totalRetries > 0;

        if (!hasMetricsRetries && !hasDbRetries) {
            report += `Нет данных о ретраях\n\n`;
        } else {
            // Show MetricsManager retries (real-time)
            if (hasMetricsRetries) {
                report += `### 📊 Real-time (MetricsManager)\n`;
                report += `- Всего попыток: ${metricsData.retries.total}\n`;
                report += `- Успешных: ${metricsData.retries.successful}\n`;
                report += `- Неудачных: ${metricsData.retries.failed}\n`;
                report += `- Средняя задержка: ${(metricsData.retries.averageDelay / 1000).toFixed(2)}s\n\n`;

                if (metricsData.retries.byModel.size > 0) {
                    report += `| Модель | Попыток | Успешно | Success Rate |\n`;
                    report += `| :--- | :---: | :---: | :---: |\n`;
                    for (const [modelID, retryStats] of metricsData.retries.byModel.entries()) {
                        const successRate = retryStats.attempts > 0
                            ? ((retryStats.successes / retryStats.attempts) * 100).toFixed(1)
                            : '0.0';
                        report += `| ${modelID} | ${retryStats.attempts} | ${retryStats.successes} | ${successRate}% |\n`;
                    }
                    report += `\n`;
                }
            }

            // Show SQLite heuristic retries (historical)
            if (hasDbRetries) {
                report += `### 📈 Historical (SQLite, based on heuristic)\n`;
                report += `> ⚠️ **Примечание**: Статистика основана на эвристике: повторные запросы в той же сессии с тем же parentID и rate-limit ошибкой\n\n`;
                report += `- Всего ретраев: ${retryDbResult.stats.totalRetries}\n\n`;

                if (retryDbResult.stats.byModel.size > 0) {
                    report += `| Модель | Попыток | Успешно | Success Rate |\n`;
                    report += `| :--- | :---: | :---: | :---: |\n`;
                    for (const [modelID, retryStats] of retryDbResult.stats.byModel.entries()) {
                        const successRate = retryStats.attempts > 0
                            ? ((retryStats.successful / retryStats.attempts) * 100).toFixed(1)
                            : '0.0';
                        report += `| ${modelID} | ${retryStats.attempts} | ${retryStats.successful} | ${successRate}% |\n`;
                    }
                    report += `\n`;
                }
            } else if (!retryDbResult.success) {
                report += `> ⚠️ **Предупреждение**: Не удалось прочитать статистику ретраев из OpenCode DB\n`;
                report += `> \`${retryDbResult.error}\`\n\n`;
            }
        }

        // FALLBACKS section - combine MetricsManager and SQLite heuristic stats
        report += `## 🔄 FALLBACKS\n`;

        const hasMetricsFallbacks = metricsData.fallbacks.total > 0;
        const hasDbFallbacks = fallbackDbResult.success && fallbackDbResult.stats.totalFallbacks > 0;

        if (!hasMetricsFallbacks && !hasDbFallbacks) {
            report += `Нет данных о фолбэках\n\n`;
        } else {
            // Show MetricsManager fallbacks (real-time)
            if (hasMetricsFallbacks) {
                report += `### 📊 Real-time (MetricsManager)\n`;
                report += `- Всего переключений: ${metricsData.fallbacks.total}\n`;
                report += `- Успешных: ${metricsData.fallbacks.successful}\n`;
                report += `- Неудачных: ${metricsData.fallbacks.failed}\n`;
                report += `- Средняя длительность: ${(metricsData.fallbacks.averageDuration / 1000).toFixed(2)}s\n\n`;

                if (metricsData.fallbacks.byTargetModel.size > 0) {
                    report += `| Модель-цель | Использована как fallback | Успешно | Неудачно |\n`;
                    report += `| :--- | :---: | :---: | :---: |\n`;
                    for (const [key, targetMetrics] of metricsData.fallbacks.byTargetModel.entries()) {
                        report += `| ${key} | ${targetMetrics.usedAsFallback} | ${targetMetrics.successful} | ${targetMetrics.failed} |\n`;
                    }
                    report += `\n`;
                }
            }

            // Show SQLite heuristic fallbacks (historical)
            if (hasDbFallbacks) {
                report += `### 📈 Historical (SQLite, based on heuristic)\n`;
                report += `> ⚠️ **Примечание**: Статистика основана на эвристике: смена provider/model при retry с rate-limit ошибкой\n\n`;
                report += `- Всего фолбэков: ${fallbackDbResult.stats.totalFallbacks}\n\n`;

                if (fallbackDbResult.stats.bySourceModel.size > 0) {
                    report += `| Исходная модель | Целевая модель | Количество |\n`;
                    report += `| :--- | :--- | :---: |\n`;
                    for (const [sourceModel, data] of fallbackDbResult.stats.bySourceModel.entries()) {
                        report += `| ${sourceModel} | ${data.targetModel} | ${data.count} |\n`;
                    }
                    report += `\n`;
                }

                if (fallbackDbResult.stats.byTargetModel.size > 0) {
                    report += `| Модель-цель | Использована как fallback |\n`;
                    report += `| :--- | :---: |\n`;
                    for (const [targetModel, data] of fallbackDbResult.stats.byTargetModel.entries()) {
                        report += `| ${targetModel} | ${data.usedAsFallback} |\n`;
                    }
                    report += `\n`;
                }
            } else if (!fallbackDbResult.success) {
                report += `> ⚠️ **Предупреждение**: Не удалось прочитать статистику фолбэков из OpenCode DB\n`;
                report += `> \`${fallbackDbResult.error}\`\n\n`;
            }
        }

        // Add health summary if no fallbacks/retries but DB data exists
        if (!hasMetricsFallbacks && !hasMetricsRetries && !hasDbFallbacks && !hasDbRetries) {
            report += `## 🏥 Health Summary\n`;
            report += `- Средний Health Score: **${healthStats.avgHealthScore}/100**\n`;
            report += `- Моделей отслеживается: ${healthStats.totalTracked}\n\n`;
        }

        return report;
    }
}

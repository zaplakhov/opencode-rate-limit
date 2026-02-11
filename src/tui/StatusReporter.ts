/**
 * TUI Status Reporter - Formats and sends metrics to OpenCode TUI
 */

import type { OpenCodeClient, PluginConfig } from '../types/index.js';
import type { Logger } from '../../logger.js';
import type { MetricsManager } from '../metrics/MetricsManager.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import { safeShowToast, getModelKey } from '../utils/helpers.js';

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
     */
    getFullReport(): string {
        const metricsData = this.metrics.getMetrics();
        const healthStats = this.health.getStats();

        let report = `# 📊 Rate Limit Fallback Status\n\n`;

        report += `## 🏥 Общее здоровье\n`;
        report += `- Средний Health Score: **${healthStats.avgHealthScore}/100**\n`;
        report += `- Моделей отслеживается: ${healthStats.totalTracked}\n`;
        report += `- Всего запросов: ${healthStats.totalRequests}\n\n`;

        report += `## ⚡ Состояние моделей\n`;
        report += `| Модель | Health | Запросы | Сбои | Прогноз |\n`;
        report += `| :--- | :---: | :---: | :---: | :---: |\n`;

        const allModels = this.health.getAllHealthData();
        for (const h of allModels) {
            const [p, m] = h.modelKey.split('/');
            const rem = this.predictRemainingRequests(p, m);
            const remStr = rem !== null ? `~${rem}` : '---';
            report += `| ${m} | **${h.healthScore}** | ${h.totalRequests} | ${h.failedRequests} | ${remStr} |\n`;
        }

        if (metricsData.fallbacks.total > 0) {
            report += `\n## 🔄 Fallbacks\n`;
            report += `- Всего переключений: ${metricsData.fallbacks.total}\n`;
            report += `- Успешных: ${metricsData.fallbacks.successful}\n`;
            report += `- Средняя длительность: ${(metricsData.fallbacks.averageDuration / 1000).toFixed(2)}s\n`;
        }

        return report;
    }
}

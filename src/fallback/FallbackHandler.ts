/**
 * Fallback orchestration logic
 */

import type { Logger } from '../../logger.js';
import type { FallbackModel, PluginConfig, OpenCodeClient, MessagePart, SessionHierarchy } from '../types/index.js';
import { SESSION_ENTRY_TTL_MS } from '../types/index.js';
import { MetricsManager } from '../metrics/MetricsManager.js';
import { ModelSelector } from './ModelSelector.js';
import { CircuitBreaker } from '../circuitbreaker/CircuitBreaker.js';
import { extractMessageParts, convertPartsToSDKFormat, safeShowToast, getStateKey, getModelKey, DEDUP_WINDOW_MS, STATE_TIMEOUT_MS } from '../utils/helpers.js';
import type { SubagentTracker } from '../session/SubagentTracker.js';
import { RetryManager } from '../retry/RetryManager.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import { StatusReporter } from '../tui/StatusReporter.js';
import { DynamicPrioritizer } from '../dynamic/DynamicPrioritizer.js';
import { DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG } from '../config/defaults.js';

/**
 * Fallback Handler class for orchestrating the fallback retry flow
 */
export class FallbackHandler {
  private config: PluginConfig;
  private client: OpenCodeClient;
  private logger: Logger;
  private modelSelector: ModelSelector;
  private currentSessionModel: Map<string, { providerID: string; modelID: string; lastUpdated: number }>;
  private modelRequestStartTimes: Map<string, number>;
  private retryState: Map<string, { attemptedModels: Set<string>; lastAttemptTime: number }>;
  private fallbackInProgress: Map<string, number>;
  private fallbackMessages: Map<string, { sessionID: string; messageID: string; timestamp: number }>;
  private sessionLock: Set<string>;

  // Metrics manager reference
  private metricsManager: MetricsManager;

  // Subagent tracker reference
  private subagentTracker: SubagentTracker;

  // Retry manager reference
  private retryManager: RetryManager;

  // Circuit breaker reference
  private circuitBreaker?: CircuitBreaker;

  // Health tracker reference
  private healthTracker?: HealthTracker;

  // Dynamic prioritizer reference
  private dynamicPrioritizer?: DynamicPrioritizer;

  // Status reporter reference
  private statusReporter?: StatusReporter;

  // Session agent tracking - stores current agent/mode for each session
  private currentSessionAgent: Map<string, { agent: string; lastUpdated: number }>;

  constructor(
    config: PluginConfig,
    client: OpenCodeClient,
    logger: Logger,
    metricsManager: MetricsManager,
    subagentTracker: SubagentTracker,
    healthTracker?: HealthTracker,
    statusReporter?: StatusReporter
  ) {
    this.config = config;
    this.client = client;
    this.logger = logger;
    this.metricsManager = metricsManager;
    this.subagentTracker = subagentTracker;
    this.healthTracker = healthTracker;
    this.statusReporter = statusReporter;

    // Initialize circuit breaker if enabled
    if (config.circuitBreaker?.enabled) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker, logger, metricsManager, client);
    }

    // Initialize dynamic prioritizer if enabled and health tracker is available
    if (healthTracker && config.dynamicPrioritization?.enabled) {
      const dynamicConfig = { ...DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG, ...config.dynamicPrioritization };
      this.dynamicPrioritizer = new DynamicPrioritizer(dynamicConfig, healthTracker, logger, metricsManager);
    }

    this.modelSelector = new ModelSelector(config, client, this.circuitBreaker, healthTracker, this.dynamicPrioritizer);

    this.currentSessionModel = new Map();
    this.currentSessionAgent = new Map();
    this.modelRequestStartTimes = new Map();
    this.retryState = new Map();
    this.fallbackInProgress = new Map();
    this.fallbackMessages = new Map();
    this.sessionLock = new Set();

    // Initialize retry manager
    this.retryManager = new RetryManager(config.retryPolicy || {}, logger);
  }

  /**
   * Check and mark fallback in progress for deduplication
   */
  private checkAndMarkFallbackInProgress(sessionID: string, messageID: string): boolean {
    const key = getStateKey(sessionID, messageID);
    const lastFallback = this.fallbackInProgress.get(key);

    this.logger.debug('Deduplication check:', {
      key,
      sessionID,
      messageID,
      lastFallback: lastFallback ? Date.now() - lastFallback : 'none',
      dedupWindowMs: DEDUP_WINDOW_MS,
      willSkip: !!lastFallback && (Date.now() - lastFallback) < DEDUP_WINDOW_MS
    });

    if (lastFallback && Date.now() - lastFallback < DEDUP_WINDOW_MS) {
      this.logger.warn('Skipping fallback - duplicate within dedup window', {
        sessionID,
        messageID,
        key
      });
      return false; // Skip - already processing
    }

    this.fallbackInProgress.set(key, Date.now());
    this.logger.debug('Dedup lock set:', { key });
    return true; // Continue processing
  }

  /**
   * Get or create retry state for a specific message
   */
  private getOrCreateRetryState(sessionID: string, messageID: string): { attemptedModels: Set<string>; lastAttemptTime: number } {
    const stateKey = getStateKey(sessionID, messageID);
    let state = this.retryState.get(stateKey);

    if (!state || Date.now() - state.lastAttemptTime > STATE_TIMEOUT_MS) {
      state = { attemptedModels: new Set<string>(), lastAttemptTime: Date.now() };
      this.retryState.set(stateKey, state);
    }

    return state;
  }

  /**
   * Get current model for a session
   */
  getSessionModel(sessionID: string): { providerID: string; modelID: string } | null {
    const tracked = this.currentSessionModel.get(sessionID);
    return tracked ? { providerID: tracked.providerID, modelID: tracked.modelID } : null;
  }

  /**
   * Get current agent for a session
   */
  getSessionAgent(sessionID: string): string | null {
    const tracked = this.currentSessionAgent.get(sessionID);
    return tracked ? tracked.agent : null;
  }

  /**
   * Fetch and store current agent from session
   */
  async fetchAndStoreSessionAgent(sessionID: string): Promise<string | null> {
    try {
      if (this.client.session.get) {
        const result = await this.client.session.get({ path: { id: sessionID } });
        const sessionData = result as { data?: { agent?: string } };
        if (sessionData.data?.agent) {
          this.currentSessionAgent.set(sessionID, {
            agent: sessionData.data.agent,
            lastUpdated: Date.now(),
          });
          this.logger.debug(`Fetched and stored agent for session ${sessionID}: ${sessionData.data.agent}`);
          return sessionData.data.agent;
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to fetch agent for session ${sessionID}`, { error });
    }
    return null;
  }

  /**
   * Abort current session with error handling
   */
  private async abortSession(sessionID: string): Promise<void> {
    try {
      await this.client.session.abort({ path: { id: sessionID } });
    } catch (abortError) {
      // Silently ignore abort errors and continue with fallback
      this.logger.debug(`Failed to abort session ${sessionID}`, { error: abortError });
    }
  }

  /**
   * Queue prompt asynchronously (non-blocking), then abort retry loop.
   * promptAsync FIRST queues pending work so that server doesn't dispose on idle.
   * abort SECOND cancels the retry loop; the server sees the queued prompt and processes it.
   */
  async retryWithModel(
    targetSessionID: string,
    model: FallbackModel,
    parts: MessagePart[],
    hierarchy: SessionHierarchy | null
  ): Promise<void> {
    // Record model usage for dynamic prioritization
    if (this.dynamicPrioritizer) {
      this.dynamicPrioritizer.recordUsage(model.providerID, model.modelID);
    }

    // Track new model for this session
    this.currentSessionModel.set(targetSessionID, {
      providerID: model.providerID,
      modelID: model.modelID,
      lastUpdated: Date.now(),
    });

    // If this is a root session with subagents, propagate model and agent to all subagents
    if (hierarchy) {
      if (hierarchy.rootSessionID === targetSessionID) {
        hierarchy.sharedFallbackState = "completed";
        hierarchy.lastActivity = Date.now();

        // Get current agent to propagate to subagents
        const currentAgent = this.getSessionAgent(targetSessionID);

        // Update model and agent tracking for all subagents
        for (const [subagentID, subagent] of hierarchy.subagents.entries()) {
          this.currentSessionModel.set(subagentID, {
            providerID: model.providerID,
            modelID: model.modelID,
            lastUpdated: Date.now(),
          });
          // Propagate agent to subagents if available
          if (currentAgent) {
            this.currentSessionAgent.set(subagentID, {
              agent: currentAgent,
              lastUpdated: Date.now(),
            });
          }
          subagent.fallbackState = "completed";
          subagent.lastActivity = Date.now();
        }
      }
    }

    // Record model request for metrics
    if (this.metricsManager) {
      this.metricsManager.recordModelRequest(model.providerID, model.modelID);
      const modelKey = getModelKey(model.providerID, model.modelID);
      this.modelRequestStartTimes.set(modelKey, Date.now());
    }

    // Convert internal MessagePart to SDK-compatible format
    const sdkParts = convertPartsToSDKFormat(parts);

    // Get current agent for the session
    let currentAgent = this.getSessionAgent(targetSessionID);

    // If agent is not tracked, try to fetch it from the session
    if (!currentAgent) {
      currentAgent = await this.fetchAndStoreSessionAgent(targetSessionID);
    }

    // For default agents: promptAsync FIRST, then abort (original proven flow)
    // For custom agents: abort FIRST to clear retry loop, delay, THEN promptAsync
    //   — Custom agents can't process promptAsync while session is in retry state
    //   — Doing promptAsync→abort kills both requests for custom agents ("interrupted")
    //   — Doing abort→delay→promptAsync clears the retry loop, then sends fresh request

    if (!currentAgent) {
      // DEFAULT AGENT FLOW: promptAsync → abort
      this.logger.debug(`Sending fallback request: ${model.providerID}/${model.modelID}`, {
        agent: 'default',
        sessionId: targetSessionID,
      });

      await this.client.session.promptAsync({
        path: { id: targetSessionID },
        body: {
          parts: sdkParts,
          model: { providerID: model.providerID, modelID: model.modelID },
        },
      });

      this.logger.debug('Aborting old request (default agent)');
      await this.abortSession(targetSessionID);
    } else {
      // CUSTOM AGENT FLOW: abort → delay → promptAsync
      this.logger.debug('Aborting retry loop before sending fallback (custom agent)', {
        agent: currentAgent,
      });
      await this.abortSession(targetSessionID);

      // Wait for abort to fully complete before sending new request
      await new Promise(resolve => setTimeout(resolve, 300));

      this.logger.debug(`Sending fallback request: ${model.providerID}/${model.modelID}`, {
        agent: currentAgent,
        sessionId: targetSessionID,
      });

      await this.client.session.promptAsync({
        path: { id: targetSessionID },
        body: {
          parts: sdkParts,
          model: { providerID: model.providerID, modelID: model.modelID },
          agent: currentAgent,
        },
      });
    }

    await safeShowToast(this.client, {
      body: {
        title: "Fallback Successful",
        message: `Now using ${model.modelID}`,
        variant: "success",
        duration: 3000,
      },
    });
  }

  /**
   * Handle the rate limit fallback process
   */
  async handleRateLimitFallback(sessionID: string, currentProviderID: string, currentModelID: string): Promise<void> {
    this.logger.debug('═══════════════════════════════════════');
    this.logger.debug('handleRateLimitFallback called', {
      sessionID,
      currentProviderID,
      currentModelID,
      currentLocks: Array.from(this.sessionLock.values()),
      currentFallbacks: Array.from(this.fallbackInProgress.entries())
    });

    // Resolve target session before acquiring lock
    const rootSessionID = this.subagentTracker.getRootSession(sessionID);
    const targetSessionID = rootSessionID || sessionID;

    // Session-level lock: prevent concurrent fallback processing
    if (this.sessionLock.has(targetSessionID)) {
      this.logger.debug(`Fallback already in progress for session ${targetSessionID}, skipping`);
      return;
    }
    this.sessionLock.add(targetSessionID);

    try {
      const hierarchy = this.subagentTracker.getHierarchy(sessionID);

      // If no model info provided, try to get from tracked session model
      if (!currentProviderID || !currentModelID) {
        const tracked = this.currentSessionModel.get(targetSessionID);
        if (tracked) {
          currentProviderID = tracked.providerID;
          currentModelID = tracked.modelID;
        }
      }

      // Record rate limit metric
      if (currentProviderID && currentModelID && this.metricsManager) {
        this.metricsManager.recordRateLimit(currentProviderID, currentModelID);
      }

      // Record health failure for current model (if health tracking is enabled)
      if (this.healthTracker && currentProviderID && currentModelID) {
        this.healthTracker.recordFailure(currentProviderID, currentModelID);
      }

      if (this.statusReporter && currentProviderID && currentModelID) {
        // Find fallback model to show in toast preview (empty attempted models for now)
        const nextModelPreview = await this.modelSelector.selectFallbackModel(currentProviderID, currentModelID, new Set<string>());

        await this.statusReporter.showRateLimitToast(
          currentProviderID,
          currentModelID,
          nextModelPreview?.providerID,
          nextModelPreview?.modelID
        );
      } else {
        await safeShowToast(this.client, {
          body: {
            title: "Rate Limit Detected",
            message: `Switching from ${currentModelID || 'current model'}...`,
            variant: "warning",
            duration: 3000,
          },
        });
      }

      // Get messages from the session
      const messagesResult = await this.client.session.messages({ path: { id: targetSessionID } });
      if (!messagesResult.data) {
        return;
      }

      const messages = messagesResult.data;
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user");
      if (!lastUserMessage) {
        return;
      }

      // Check deduplication with message scope
      const dedupSessionID = rootSessionID || sessionID;
      if (!this.checkAndMarkFallbackInProgress(dedupSessionID, lastUserMessage.info.id)) {
        return; // Skip - already processing
      }

      // Get or create retry state for this message
      const state = this.getOrCreateRetryState(sessionID, lastUserMessage.info.id);

      // Update hierarchy state if exists
      if (hierarchy && rootSessionID) {
        hierarchy.sharedFallbackState = "in_progress";
        hierarchy.lastActivity = Date.now();
        const subagent = hierarchy.subagents.get(sessionID);
        if (subagent) {
          subagent.fallbackState = "in_progress";
          subagent.lastActivity = Date.now();
        }
      }

      const stateKey = getStateKey(sessionID, lastUserMessage.info.id);
      const fallbackKey = getStateKey(dedupSessionID, lastUserMessage.info.id);

      // Check if retry should be attempted (using retry manager)
      if (!this.retryManager.canRetry(dedupSessionID, lastUserMessage.info.id)) {
        await safeShowToast(this.client, {
          body: {
            title: "Fallback Exhausted",
            message: "All retry attempts failed",
            variant: "error",
            duration: 5000,
          },
        });
        this.logger.warn('Retry exhausted', { sessionID: dedupSessionID, messageID: lastUserMessage.info.id });
        this.retryState.delete(stateKey);
        this.fallbackInProgress.delete(fallbackKey);

        // Record retry failure metric
        if (this.metricsManager) {
          this.metricsManager.recordRetryFailure();
        }
        return;
      }

      // Get delay for next retry
      const delay = this.retryManager.getRetryDelay(dedupSessionID, lastUserMessage.info.id);

      // Apply delay if configured
      if (delay > 0) {
        this.logger.debug(`Applying retry delay`, { delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Select the next fallback model
      const nextModel = await this.modelSelector.selectFallbackModel(currentProviderID, currentModelID, state.attemptedModels);

      // Show error if no model is available
      if (!nextModel) {
        await safeShowToast(this.client, {
          body: {
            title: "No Fallback Available",
            message: this.config.fallbackMode === "stop"
              ? "All fallback models exhausted"
              : "All models are rate limited",
            variant: "error",
            duration: 5000,
          },
        });
        this.retryState.delete(stateKey);
        this.fallbackInProgress.delete(fallbackKey);
        return;
      }

      state.attemptedModels.add(getModelKey(nextModel.providerID, nextModel.modelID));
      state.lastAttemptTime = Date.now();

      // Record retry attempt
      this.retryManager.recordRetry(dedupSessionID, lastUserMessage.info.id, nextModel.modelID, delay);

      // Record retry metric
      if (this.metricsManager) {
        this.metricsManager.recordRetryAttempt(nextModel.modelID, delay);
      }

      // Extract message parts
      const parts = extractMessageParts(lastUserMessage);

      if (parts.length === 0) {
        this.fallbackInProgress.delete(fallbackKey);
        return;
      }

      await safeShowToast(this.client, {
        body: {
          title: "Retrying",
          message: `Using ${nextModel.providerID}/${nextModel.modelID}${delay > 0 ? ` (after ${delay}ms)` : ''}`,
          variant: "info",
          duration: 3000,
        },
      });

      // Record fallback start time
      if (this.metricsManager) {
        this.metricsManager.recordFallbackStart();
      }

      // Track this message as a fallback message for completion detection
      this.fallbackMessages.set(fallbackKey, {
        sessionID: dedupSessionID,
        messageID: lastUserMessage.info.id,
        timestamp: Date.now(),
      });

      // Record retry start time for health tracking
      const retryStartTime = Date.now();

      // Retry with the selected model
      await this.retryWithModel(dedupSessionID, nextModel, parts, hierarchy);

      // Record health success for fallback model
      if (this.healthTracker) {
        const responseTime = Date.now() - retryStartTime;
        this.healthTracker.recordSuccess(nextModel.providerID, nextModel.modelID, responseTime);
      }

      // Record retry success
      this.retryManager.recordSuccess(dedupSessionID, nextModel.modelID);
      if (this.metricsManager) {
        this.metricsManager.recordRetrySuccess(nextModel.modelID);
      }

      // Clean up state
      this.retryState.delete(stateKey);

      this.logger.debug('Fallback completed successfully, cleaning up', {
        sessionID: targetSessionID,
        messageID: lastUserMessage.info.id,
        fallbackKey
      });

    } catch (err) {
      // Log fallback errors at warn level for visibility
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : undefined;
      this.logger.warn(`Fallback error for session ${sessionID}`, {
        error: errorMessage,
        name: errorName,
      });

      // Record retry failure on error
      this.retryManager.recordFailure(targetSessionID);
    } finally {
      this.sessionLock.delete(targetSessionID);
      this.logger.debug('Session lock removed', { sessionID: targetSessionID });
      this.logger.debug('═══════════════════════════════════════');
    }
  }

  /**
   * Handle message updated events for metrics recording
   */
  handleMessageUpdated(sessionID: string, messageID: string, hasError: boolean, isError: boolean): void {
    if (hasError && !isError) {
      // Non-rate-limit error - record model failure metric
      const tracked = this.currentSessionModel.get(sessionID);
      if (tracked) {
        // Record failure to circuit breaker (isRateLimit = false)
        if (this.circuitBreaker) {
          const modelKey = getModelKey(tracked.providerID, tracked.modelID);
          this.circuitBreaker.recordFailure(modelKey, false);
        }

        if (this.metricsManager) {
          this.metricsManager.recordModelFailure(tracked.providerID, tracked.modelID);

          // Check if this was a fallback attempt and record failure
          const fallbackKey = getStateKey(sessionID, messageID);
          const fallbackInfo = this.fallbackMessages.get(fallbackKey);
          if (fallbackInfo) {
            this.metricsManager.recordFallbackFailure();
            this.fallbackInProgress.delete(fallbackKey);
            this.fallbackMessages.delete(fallbackKey);
          }
        }
      }
    } else if (!hasError) {
      // Check if this message is a fallback message and clear its in-progress state
      const fallbackKey = getStateKey(sessionID, messageID);
      const fallbackInfo = this.fallbackMessages.get(fallbackKey);
      if (fallbackInfo) {
        // Clear fallback in progress for this message
        this.fallbackInProgress.delete(fallbackKey);
        this.fallbackMessages.delete(fallbackKey);
        this.logger.debug(`Fallback completed for message ${messageID}`, { sessionID });

        // Record fallback success metric
        const tracked = this.currentSessionModel.get(sessionID);
        if (tracked) {
          // Record success to circuit breaker
          if (this.circuitBreaker) {
            const modelKey = getModelKey(tracked.providerID, tracked.modelID);
            this.circuitBreaker.recordSuccess(modelKey);
          }

          if (this.metricsManager) {
            this.metricsManager.recordFallbackSuccess(tracked.providerID, tracked.modelID, fallbackInfo.timestamp);

            // Record model performance metric
            const modelKey = getModelKey(tracked.providerID, tracked.modelID);
            const startTime = this.modelRequestStartTimes.get(modelKey);
            if (startTime) {
              const responseTime = Date.now() - startTime;
              this.metricsManager.recordModelSuccess(tracked.providerID, tracked.modelID, responseTime);
              this.modelRequestStartTimes.delete(modelKey);
            }
          }

          // Record successful request in status reporter for TUI counters
          if (this.statusReporter) {
            this.statusReporter.recordRequest(tracked.providerID, tracked.modelID);
          }
        }
      }
    }
  }

  /**
   * Set model for a session
   */
  setSessionModel(sessionID: string, providerID: string, modelID: string): void {
    this.currentSessionModel.set(sessionID, {
      providerID,
      modelID,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Set agent for a session
   */
  setSessionAgent(sessionID: string, agent: string): void {
    this.currentSessionAgent.set(sessionID, {
      agent,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Clean up stale entries
   */
  cleanupStaleEntries(): void {
    const now = Date.now();

    for (const [sessionID, entry] of this.currentSessionModel.entries()) {
      if (now - entry.lastUpdated > SESSION_ENTRY_TTL_MS) {
        this.currentSessionModel.delete(sessionID);
      }
    }

    for (const [stateKey, state] of this.retryState.entries()) {
      if (now - state.lastAttemptTime > STATE_TIMEOUT_MS) {
        this.retryState.delete(stateKey);
      }
    }

    for (const [sessionID, agentEntry] of this.currentSessionAgent.entries()) {
      if (now - agentEntry.lastUpdated > SESSION_ENTRY_TTL_MS) {
        this.currentSessionAgent.delete(sessionID);
      }
    }

    for (const [fallbackKey, fallbackInfo] of this.fallbackMessages.entries()) {
      if (now - fallbackInfo.timestamp > SESSION_ENTRY_TTL_MS) {
        this.fallbackInProgress.delete(fallbackKey);
        this.fallbackMessages.delete(fallbackKey);
      }
    }

    this.modelSelector.cleanupStaleEntries();
    this.retryManager.cleanupStaleEntries(SESSION_ENTRY_TTL_MS);

    // Clean up circuit breaker stale entries
    if (this.circuitBreaker) {
      this.circuitBreaker.cleanupStaleEntries();
    }
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.currentSessionModel.clear();
    this.currentSessionAgent.clear();
    this.modelRequestStartTimes.clear();
    this.retryState.clear();
    this.fallbackInProgress.clear();
    this.fallbackMessages.clear();
    this.sessionLock.clear();
    this.retryManager.destroy();

    // Destroy circuit breaker
    if (this.circuitBreaker) {
      this.circuitBreaker.destroy();
    }
  }

  /**
   * Update configuration (for hot reload)
   */
  updateConfig(newConfig: PluginConfig): void {
    this.config = newConfig;

    // Update model selector
    this.modelSelector.updateConfig(newConfig);

    // Update retry manager
    this.retryManager.updateConfig(newConfig.retryPolicy || {});

    // Recreate circuit breaker if configuration changed significantly
    const oldCircuitBreakerEnabled = this.circuitBreaker !== undefined;
    if (newConfig.circuitBreaker?.enabled !== oldCircuitBreakerEnabled) {
      // Destroy existing circuit breaker
      if (this.circuitBreaker) {
        this.circuitBreaker.destroy();
      }

      // Create new circuit breaker if enabled
      if (newConfig.circuitBreaker?.enabled) {
        this.circuitBreaker = new CircuitBreaker(newConfig.circuitBreaker, this.logger, this.metricsManager, this.client);
        this.modelSelector.setCircuitBreaker(this.circuitBreaker);
      } else {
        this.circuitBreaker = undefined;
        this.modelSelector.setCircuitBreaker(undefined);
      }
    }

    // Handle dynamic prioritizer configuration changes
    const oldDynamicPrioritizerEnabled = this.dynamicPrioritizer !== undefined;
    if (newConfig.dynamicPrioritization?.enabled !== oldDynamicPrioritizerEnabled) {
      if (newConfig.dynamicPrioritization?.enabled && this.healthTracker) {
        // Create new dynamic prioritizer
        const dynamicConfig = { ...DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG, ...newConfig.dynamicPrioritization };
        this.dynamicPrioritizer = new DynamicPrioritizer(dynamicConfig, this.healthTracker, this.logger, this.metricsManager);
        this.modelSelector.setDynamicPrioritizer(this.dynamicPrioritizer);
      } else if (!newConfig.dynamicPrioritization?.enabled) {
        // Disable dynamic prioritizer
        this.dynamicPrioritizer = undefined;
        this.modelSelector.setDynamicPrioritizer(undefined);
      }
    } else if (this.dynamicPrioritizer && newConfig.dynamicPrioritization) {
      // Update existing dynamic prioritizer config
      const dynamicConfig = { ...DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG, ...newConfig.dynamicPrioritization };
      this.dynamicPrioritizer.updateConfig(dynamicConfig);
    }

    this.logger.debug('FallbackHandler configuration updated');
  }
}

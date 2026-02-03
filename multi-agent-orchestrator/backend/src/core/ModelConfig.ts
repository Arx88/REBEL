/**
 * Model Configuration with Automatic Fallback System
 * 
 * Provides intelligent model selection with automatic fallback to cheaper/faster
 * models when rate limits are hit or primary models fail.
 */

export type ModelTier = 'premium' | 'standard' | 'fallback' | 'emergency';

export interface ModelDefinition {
  id: string;
  name: string;
  provider: 'gemini' | 'qwen';
  tier: ModelTier;
  command: string;
  args: string[];
  capabilities: {
    maxTokens: number;
    supportsStreaming: boolean;
    bestFor: ('planning' | 'coding' | 'analysis' | 'validation')[];
  };
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  priority: number; // Lower = higher priority (used first)
}

export interface ModelUsageStats {
  modelId: string;
  requestCount: number;
  errorCount: number;
  rateLimitHits: number;
  lastRateLimitAt: number | null;
  averageResponseTime: number;
  isAvailable: boolean;
  cooldownUntil: number | null;
}

export interface FallbackEvent {
  timestamp: number;
  fromModel: string;
  toModel: string;
  reason: 'rate_limit' | 'error' | 'timeout' | 'circuit_breaker';
  taskId?: number;
}

// Default model hierarchy - ordered by priority
export const MODEL_HIERARCHY: ModelDefinition[] = [
  // GEMINI MODELS
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    tier: 'premium',
    command: 'gemini',
    args: ['-m', 'gemini-2.5-pro'],
    capabilities: {
      maxTokens: 1000000,
      supportsStreaming: true,
      bestFor: ['planning', 'analysis', 'validation']
    },
    rateLimits: {
      requestsPerMinute: 10,
      tokensPerMinute: 250000
    },
    priority: 1
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    tier: 'standard',
    command: 'gemini',
    args: ['-m', 'gemini-2.5-flash'],
    capabilities: {
      maxTokens: 1000000,
      supportsStreaming: true,
      bestFor: ['planning', 'coding', 'analysis']
    },
    rateLimits: {
      requestsPerMinute: 30,
      tokensPerMinute: 500000
    },
    priority: 2
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    tier: 'fallback',
    command: 'gemini',
    args: ['-m', 'gemini-2.0-flash'],
    capabilities: {
      maxTokens: 1000000,
      supportsStreaming: true,
      bestFor: ['coding', 'analysis']
    },
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 1000000
    },
    priority: 3
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'gemini',
    tier: 'emergency',
    command: 'gemini',
    args: ['-m', 'gemini-1.5-flash'],
    capabilities: {
      maxTokens: 1000000,
      supportsStreaming: true,
      bestFor: ['coding']
    },
    rateLimits: {
      requestsPerMinute: 100,
      tokensPerMinute: 2000000
    },
    priority: 4
  },

  // QWEN MODELS
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'qwen',
    tier: 'premium',
    command: 'qwen',
    args: ['-m', 'qwen-max'],
    capabilities: {
      maxTokens: 32000,
      supportsStreaming: true,
      bestFor: ['coding', 'analysis']
    },
    rateLimits: {
      requestsPerMinute: 20,
      tokensPerMinute: 100000
    },
    priority: 1
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'qwen',
    tier: 'standard',
    command: 'qwen',
    args: ['-m', 'qwen-plus'],
    capabilities: {
      maxTokens: 32000,
      supportsStreaming: true,
      bestFor: ['coding']
    },
    rateLimits: {
      requestsPerMinute: 40,
      tokensPerMinute: 200000
    },
    priority: 2
  },
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'qwen',
    tier: 'fallback',
    command: 'qwen',
    args: ['-m', 'qwen-turbo'],
    capabilities: {
      maxTokens: 16000,
      supportsStreaming: true,
      bestFor: ['coding']
    },
    rateLimits: {
      requestsPerMinute: 80,
      tokensPerMinute: 400000
    },
    priority: 3
  },
  {
    id: 'qwen-lite',
    name: 'Qwen Lite',
    provider: 'qwen',
    tier: 'emergency',
    command: 'qwen',
    args: ['-m', 'qwen-lite'],
    capabilities: {
      maxTokens: 8000,
      supportsStreaming: true,
      bestFor: ['coding']
    },
    rateLimits: {
      requestsPerMinute: 120,
      tokensPerMinute: 600000
    },
    priority: 4
  }
];

export class ModelManager {
  private models: Map<string, ModelDefinition> = new Map();
  private usageStats: Map<string, ModelUsageStats> = new Map();
  private fallbackHistory: FallbackEvent[] = [];
  private readonly COOLDOWN_DURATION_MS = 60000; // 1 minute cooldown after rate limit
  private readonly MAX_FALLBACK_HISTORY = 100;

  constructor(customModels?: ModelDefinition[]) {
    const modelsToUse = customModels || MODEL_HIERARCHY;
    for (const model of modelsToUse) {
      this.models.set(model.id, model);
      this.usageStats.set(model.id, {
        modelId: model.id,
        requestCount: 0,
        errorCount: 0,
        rateLimitHits: 0,
        lastRateLimitAt: null,
        averageResponseTime: 0,
        isAvailable: true,
        cooldownUntil: null
      });
    }
  }

  /**
   * Get the best available model for a provider
   */
  getBestAvailableModel(provider: 'gemini' | 'qwen', taskType?: string): ModelDefinition | null {
    const providerModels = Array.from(this.models.values())
      .filter(m => m.provider === provider)
      .sort((a, b) => a.priority - b.priority);

    for (const model of providerModels) {
      const stats = this.usageStats.get(model.id);
      if (stats && this.isModelAvailable(model.id)) {
        // If task type specified, prefer models that are best for it
        if (taskType && model.capabilities.bestFor.includes(taskType as any)) {
          return model;
        }
        return model;
      }
    }

    // All models in cooldown, return the one with shortest remaining cooldown
    const modelWithShortestCooldown = providerModels
      .map(m => ({ model: m, stats: this.usageStats.get(m.id)! }))
      .sort((a, b) => (a.stats.cooldownUntil || 0) - (b.stats.cooldownUntil || 0))[0];

    return modelWithShortestCooldown?.model || null;
  }

  /**
   * Check if a model is currently available (not in cooldown)
   */
  isModelAvailable(modelId: string): boolean {
    const stats = this.usageStats.get(modelId);
    if (!stats) return false;

    if (stats.cooldownUntil && Date.now() < stats.cooldownUntil) {
      return false;
    }

    // Clear cooldown if expired
    if (stats.cooldownUntil && Date.now() >= stats.cooldownUntil) {
      stats.cooldownUntil = null;
      stats.isAvailable = true;
    }

    return stats.isAvailable;
  }

  /**
   * Record a rate limit hit and initiate fallback
   */
  recordRateLimit(modelId: string, taskId?: number): ModelDefinition | null {
    const stats = this.usageStats.get(modelId);
    const currentModel = this.models.get(modelId);
    
    if (!stats || !currentModel) return null;

    stats.rateLimitHits++;
    stats.lastRateLimitAt = Date.now();
    stats.cooldownUntil = Date.now() + this.COOLDOWN_DURATION_MS;
    stats.isAvailable = false;

    // Find fallback model
    const fallbackModel = this.getFallbackModel(currentModel.provider, modelId);
    
    if (fallbackModel) {
      this.recordFallbackEvent(modelId, fallbackModel.id, 'rate_limit', taskId);
    }

    return fallbackModel;
  }

  /**
   * Record an error for a model
   */
  recordError(modelId: string, isCircuitBreaker: boolean = false, taskId?: number): ModelDefinition | null {
    const stats = this.usageStats.get(modelId);
    const currentModel = this.models.get(modelId);
    
    if (!stats || !currentModel) return null;

    stats.errorCount++;

    // If circuit breaker opened, put model in cooldown
    if (isCircuitBreaker) {
      stats.cooldownUntil = Date.now() + this.COOLDOWN_DURATION_MS * 2; // Longer cooldown for circuit breaker
      stats.isAvailable = false;
      
      const fallbackModel = this.getFallbackModel(currentModel.provider, modelId);
      if (fallbackModel) {
        this.recordFallbackEvent(modelId, fallbackModel.id, 'circuit_breaker', taskId);
      }
      return fallbackModel;
    }

    return null;
  }

  /**
   * Record successful request
   */
  recordSuccess(modelId: string, responseTimeMs: number): void {
    const stats = this.usageStats.get(modelId);
    if (!stats) return;

    stats.requestCount++;
    // Update rolling average
    stats.averageResponseTime = (stats.averageResponseTime * (stats.requestCount - 1) + responseTimeMs) / stats.requestCount;
  }

  /**
   * Request a fallback model due to non-rate-limit failures
   */
  requestFallback(
    modelId: string,
    reason: 'error' | 'timeout' | 'circuit_breaker',
    taskId?: number
  ): ModelDefinition | null {
    const currentModel = this.models.get(modelId);
    if (!currentModel) return null;

    const fallbackModel = this.getFallbackModel(currentModel.provider, modelId);
    if (fallbackModel) {
      this.recordFallbackEvent(modelId, fallbackModel.id, reason, taskId);
    }

    return fallbackModel;
  }

  /**
   * Get the next fallback model in the hierarchy
   */
  private getFallbackModel(provider: 'gemini' | 'qwen', currentModelId: string): ModelDefinition | null {
    const currentModel = this.models.get(currentModelId);
    if (!currentModel) return null;

    const providerModels = Array.from(this.models.values())
      .filter(m => m.provider === provider && m.priority > currentModel.priority)
      .sort((a, b) => a.priority - b.priority);

    for (const model of providerModels) {
      if (this.isModelAvailable(model.id)) {
        return model;
      }
    }

    return providerModels[0] || null; // Return next in line even if in cooldown
  }

  /**
   * Record a fallback event for analytics
   */
  private recordFallbackEvent(fromModel: string, toModel: string, reason: FallbackEvent['reason'], taskId?: number): void {
    this.fallbackHistory.push({
      timestamp: Date.now(),
      fromModel,
      toModel,
      reason,
      taskId
    });

    // Keep history bounded
    if (this.fallbackHistory.length > this.MAX_FALLBACK_HISTORY) {
      this.fallbackHistory = this.fallbackHistory.slice(-this.MAX_FALLBACK_HISTORY);
    }
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): ModelDefinition | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all models for a provider
   */
  getModelsForProvider(provider: 'gemini' | 'qwen'): ModelDefinition[] {
    return Array.from(this.models.values())
      .filter(m => m.provider === provider)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get complete status for all models
   */
  getAllModelStatus(): Array<ModelDefinition & { stats: ModelUsageStats; available: boolean }> {
    return Array.from(this.models.values()).map(model => ({
      ...model,
      stats: this.usageStats.get(model.id)!,
      available: this.isModelAvailable(model.id)
    }));
  }

  /**
   * Get fallback history
   */
  getFallbackHistory(limit: number = 20): FallbackEvent[] {
    return this.fallbackHistory.slice(-limit);
  }

  /**
   * Get stats summary
   */
  getStatsSummary(): {
    totalRequests: number;
    totalErrors: number;
    totalRateLimits: number;
    totalFallbacks: number;
    modelBreakdown: Record<string, ModelUsageStats>;
  } {
    const allStats = Array.from(this.usageStats.values());
    
    return {
      totalRequests: allStats.reduce((sum, s) => sum + s.requestCount, 0),
      totalErrors: allStats.reduce((sum, s) => sum + s.errorCount, 0),
      totalRateLimits: allStats.reduce((sum, s) => sum + s.rateLimitHits, 0),
      totalFallbacks: this.fallbackHistory.length,
      modelBreakdown: Object.fromEntries(this.usageStats)
    };
  }

  /**
   * Reset cooldown for a specific model (manual override)
   */
  resetCooldown(modelId: string): void {
    const stats = this.usageStats.get(modelId);
    if (stats) {
      stats.cooldownUntil = null;
      stats.isAvailable = true;
    }
  }

  /**
   * Reset all stats (for testing)
   */
  resetAllStats(): void {
    for (const [modelId] of this.usageStats) {
      this.usageStats.set(modelId, {
        modelId,
        requestCount: 0,
        errorCount: 0,
        rateLimitHits: 0,
        lastRateLimitAt: null,
        averageResponseTime: 0,
        isAvailable: true,
        cooldownUntil: null
      });
    }
    this.fallbackHistory = [];
  }
}

// Singleton instance
export const modelManager = new ModelManager();

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ModelDefinition, ModelManager, modelManager } from './ModelConfig';

export interface CLIConfig {
  command: string;
  args: string[];
  model: 'gemini' | 'qwen';
  agentId: string;
  modelId?: string; // Specific model ID for fallback tracking
}

// Rate limit detection patterns for different providers
const RATE_LIMIT_PATTERNS = {
  gemini: [
    /rate limit/i,
    /quota exceeded/i,
    /too many requests/i,
    /429/,
    /resource exhausted/i,
    /RESOURCE_EXHAUSTED/i,
  ],
  qwen: [
    /rate limit/i,
    /too many requests/i,
    /429/,
    /throttl/i,
    /quota/i,
  ]
};

export interface CLIResponse {
  success: boolean;
  data: string;
  error?: string;
  executionTime: number;
  retryCount?: number;
  modelUsed?: string;
  wasRateLimited?: boolean;
  fallbackUsed?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

export class CLIExecutor extends EventEmitter {
  private process: ChildProcess | null = null;
  private isReady: boolean = false;
  private isExecuting: boolean = false;
  private responseBuffer: string = '';
  private currentResolve: ((value: CLIResponse) => void) | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private initAttempts: number = 0;
  private readonly MAX_INIT_ATTEMPTS = 3;
  private readonly RESPONSE_TIMEOUT = 300000; // 5 min
  private readonly IDLE_TIMEOUT = 600000; // 10 min
  private idleTimeoutId: NodeJS.Timeout | null = null;
  
  // Model fallback tracking
  private modelManager: ModelManager = modelManager;
  private currentModelId: string;
  private originalModelId: string;
  private fallbackAttempts: number = 0;
  private readonly MAX_FALLBACK_ATTEMPTS = 3;
  
  // Circuit Breaker
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed'
  };
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_RESET_MS = 60000; // 1 min
  
  // Retry configuration
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000
  };

  // Response detection patterns per model
  private readonly RESPONSE_END_PATTERNS: Record<string, RegExp[]> = {
    gemini: [
      /\n\s*$/,                          // Empty line at end
      /```\s*\n\s*$/,                    // Code block end
      /\.\s*\n\s*$/,                     // Sentence end
      /}\s*\n\s*$/,                      // JSON end
    ],
    qwen: [
      /\n\s*$/,
      /```\s*\n\s*$/,
      /\.\s*\n\s*$/,
      /}\s*\n\s*$/,
    ]
  };

  private silenceTimeoutId: NodeJS.Timeout | null = null;
  private readonly SILENCE_THRESHOLD = 5000; // 5s de silencio = respuesta completa

  constructor(private config: CLIConfig) {
    super();
    // Initialize model tracking
    this.currentModelId = config.modelId || this.getDefaultModelId(config.model);
    this.originalModelId = this.currentModelId;
  }

  private getDefaultModelId(provider: 'gemini' | 'qwen'): string {
    const model = this.modelManager.getBestAvailableModel(provider);
    return model?.id || (provider === 'gemini' ? 'gemini-2.5-pro' : 'qwen-max');
  }

  /**
   * Check if response contains rate limit indicators
   */
  private isRateLimitError(response: string): boolean {
    const patterns = RATE_LIMIT_PATTERNS[this.config.model];
    return patterns.some(pattern => pattern.test(response));
  }

  /**
   * Handle rate limit by switching to fallback model
   */
  private async handleRateLimit(taskId?: number): Promise<ModelDefinition | null> {
    console.log(`[${this.config.agentId}] Rate limit detected on ${this.currentModelId}`);
    
    const fallbackModel = this.modelManager.recordRateLimit(this.currentModelId, taskId);
    
    if (fallbackModel && this.fallbackAttempts < this.MAX_FALLBACK_ATTEMPTS) {
      this.fallbackAttempts++;
      console.log(`[${this.config.agentId}] Falling back to ${fallbackModel.id} (attempt ${this.fallbackAttempts}/${this.MAX_FALLBACK_ATTEMPTS})`);
      
      // Update config for new model
      this.currentModelId = fallbackModel.id;
      this.config.command = fallbackModel.command;
      this.config.args = [...fallbackModel.args];
      
      // Emit fallback event for UI notification
      this.emit('model_fallback', {
        agentId: this.config.agentId,
        fromModel: this.originalModelId,
        toModel: fallbackModel.id,
        reason: 'rate_limit',
        fallbackAttempt: this.fallbackAttempts,
        maxAttempts: this.MAX_FALLBACK_ATTEMPTS,
        taskId
      });
      
      // Reinitialize with new model
      await this.destroy();
      this.initAttempts = 0;
      await this.initialize();
      
      return fallbackModel;
    }
    
    return null;
  }

  /**
   * Get current model information
   */
  getCurrentModel(): { id: string; original: string; fallbackCount: number } {
    return {
      id: this.currentModelId,
      original: this.originalModelId,
      fallbackCount: this.fallbackAttempts
    };
  }

  /**
   * Reset to original model (call when rate limit cooldown expires)
   */
  async resetToOriginalModel(): Promise<void> {
    if (this.currentModelId !== this.originalModelId) {
      console.log(`[${this.config.agentId}] Resetting to original model ${this.originalModelId}`);
      
      const originalModel = this.modelManager.getModel(this.originalModelId);
      if (originalModel && this.modelManager.isModelAvailable(this.originalModelId)) {
        this.currentModelId = this.originalModelId;
        this.config.command = originalModel.command;
        this.config.args = [...originalModel.args];
        this.fallbackAttempts = 0;
        
        await this.destroy();
        this.initAttempts = 0;
        await this.initialize();
        
        this.emit('model_restored', {
          agentId: this.config.agentId,
          model: this.originalModelId
        });
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.circuitBreaker.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_MS) {
        throw new Error(`Circuit breaker open for ${this.config.agentId}. Retry in ${Math.ceil((this.CIRCUIT_BREAKER_RESET_MS - timeSinceLastFailure) / 1000)}s`);
      }
      this.circuitBreaker.state = 'half-open';
    }

    return this.initializeWithRetry();
  }

  private async initializeWithRetry(): Promise<void> {
    while (this.initAttempts < this.MAX_INIT_ATTEMPTS) {
      try {
        await this.doInitialize();
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.state = 'closed';
        return;
      } catch (error) {
        this.initAttempts++;
        console.error(`[${this.config.agentId}] Init attempt ${this.initAttempts}/${this.MAX_INIT_ATTEMPTS} failed:`, error);
        
        if (this.initAttempts >= this.MAX_INIT_ATTEMPTS) {
          this.recordFailure();
          throw new Error(`Failed to initialize ${this.config.agentId} after ${this.MAX_INIT_ATTEMPTS} attempts`);
        }
        
        const delay = Math.min(this.retryConfig.baseDelayMs * Math.pow(2, this.initAttempts - 1), this.retryConfig.maxDelayMs);
        await this.sleep(delay);
      }
    }
  }

  private doInitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[${this.config.agentId}] Starting CLI: ${this.config.command} ${this.config.args.join(' ')}`);

        this.process = spawn(this.config.command, this.config.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          env: { 
            ...process.env, 
            FORCE_COLOR: '0', 
            NO_COLOR: '1',
            TERM: 'dumb'
          }
        });

        let initBuffer = '';
        let initTimeout: NodeJS.Timeout;

        const cleanup = () => {
          if (initTimeout) clearTimeout(initTimeout);
        };

        initTimeout = setTimeout(() => {
          if (!this.isReady) {
            cleanup();
            // If we have some output, consider it ready
            if (initBuffer.length > 0) {
              this.isReady = true;
              console.log(`[${this.config.agentId}] CLI ready (timeout with output)`);
              this.startIdleTimer();
              resolve();
            } else {
              reject(new Error('CLI initialization timeout - no output received'));
            }
          }
        }, 30000);

        this.process.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          
          if (!this.isReady) {
            initBuffer += chunk;
            // Check multiple ready indicators
            if (this.isCLIReady(initBuffer)) {
              this.isReady = true;
              cleanup();
              console.log(`[${this.config.agentId}] CLI ready`);
              this.startIdleTimer();
              resolve();
            }
          } else if (this.isExecuting) {
            this.handleResponseChunk(chunk);
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          const error = data.toString();
          
          // Some CLIs output to stderr during init
          if (!this.isReady) {
            initBuffer += error;
            if (this.isCLIReady(initBuffer)) {
              this.isReady = true;
              cleanup();
              console.log(`[${this.config.agentId}] CLI ready (via stderr)`);
              this.startIdleTimer();
              resolve();
            }
          } else if (this.isExecuting) {
            // Log stderr but don't fail - some warnings are normal
            console.warn(`[${this.config.agentId}] stderr during execution:`, error.substring(0, 200));
          }
        });

        this.process.on('error', (error) => {
          cleanup();
          reject(error);
        });

        this.process.on('exit', (code, signal) => {
          const wasReady = this.isReady;
          this.isReady = false;
          cleanup();
          
          if (!wasReady) {
            reject(new Error(`CLI exited during init with code ${code}, signal ${signal}`));
          } else {
            console.log(`[${this.config.agentId}] CLI process exited: code=${code}, signal=${signal}`);
            this.emit('process_exit', { code, signal });
            
            // Try to reconnect if we were ready
            this.attemptReconnect();
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private isCLIReady(buffer: string): boolean {
    const readyPatterns = [
      />\s*$/,                           // Prompt ending with >
      /\$\s*$/,                          // Shell prompt
      /:\s*$/,                           // Prompt ending with :
      /ready/i,                          // "ready" text
      /waiting for input/i,              // Waiting message
      /type.*message/i,                  // "type a message" prompt
      /enter.*prompt/i,                  // "enter prompt" message
      /\n\s*\n/,                         // Double newline (output finished)
    ];

    return readyPatterns.some(pattern => pattern.test(buffer));
  }

  private handleResponseChunk(chunk: string): void {
    this.responseBuffer += chunk;
    this.emit('data', chunk);
    
    // Reset silence timer on each chunk
    this.resetSilenceTimer();
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimeoutId) {
      clearTimeout(this.silenceTimeoutId);
    }
    
    this.silenceTimeoutId = setTimeout(() => {
      if (this.isExecuting && this.responseBuffer.length > 0) {
        // Check if response looks complete
        if (this.isResponseLikelyComplete(this.responseBuffer)) {
          console.log(`[${this.config.agentId}] Response complete (silence detection)`);
          this.finishExecution(true);
        }
      }
    }, this.SILENCE_THRESHOLD);
  }

  private isResponseLikelyComplete(buffer: string): boolean {
    const trimmed = buffer.trim();
    
    // If empty, not complete
    if (trimmed.length === 0) return false;
    
    // Check for natural endings
    const naturalEndings = [
      /```\s*$/,                    // Code block end
      /}\s*$/,                      // JSON end
      /\.\s*$/,                     // Sentence end
      /\?\s*$/,                     // Question end
      /!\s*$/,                      // Exclamation end
      /:\s*$/,                      // List/heading end
      /]\s*$/,                      // Array end
    ];
    
    if (naturalEndings.some(pattern => pattern.test(trimmed))) {
      return true;
    }
    
    // If we have substantial content (>100 chars) and ended with newline, likely complete
    if (trimmed.length > 100 && buffer.endsWith('\n')) {
      return true;
    }
    
    return false;
  }

  async execute(prompt: string, context?: string, taskId?: number): Promise<CLIResponse> {
    // Check circuit breaker
    if (this.circuitBreaker.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_MS) {
        return {
          success: false,
          data: '',
          error: `Circuit breaker open. Retry in ${Math.ceil((this.CIRCUIT_BREAKER_RESET_MS - timeSinceLastFailure) / 1000)}s`,
          executionTime: 0
        };
      }
      this.circuitBreaker.state = 'half-open';
    }

    if (!this.isReady || !this.process) {
      // Try to reconnect
      try {
        await this.initialize();
      } catch (error) {
        return {
          success: false,
          data: '',
          error: `CLI not ready and reconnection failed: ${error}`,
          executionTime: 0
        };
      }
    }

    return this.executeWithRetry(prompt, context, 0, taskId);
  }

  private async executeWithRetry(prompt: string, context?: string, retryCount: number = 0, taskId?: number): Promise<CLIResponse> {
    const modelAtStart = this.currentModelId;
    
    try {
      const result = await this.doExecute(prompt, context);
      
      // Check for rate limit in response
      if (result.success && this.isRateLimitError(result.data)) {
        console.log(`[${this.config.agentId}] Rate limit detected in response`);
        
        const fallbackModel = await this.handleRateLimit(taskId);
        if (fallbackModel) {
          // Retry with fallback model
          return this.executeWithRetry(prompt, context, retryCount, taskId);
        }
        
        return {
          ...result,
          success: false,
          error: 'Rate limit exceeded on all available models',
          wasRateLimited: true,
          modelUsed: this.currentModelId
        };
      }
      
      // Success - reset circuit breaker and record stats
      if (result.success) {
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.state = 'closed';
        this.modelManager.recordSuccess(this.currentModelId, result.executionTime);
      }
      
      result.retryCount = retryCount;
      result.modelUsed = this.currentModelId;
      result.fallbackUsed = this.currentModelId !== this.originalModelId;
      
      return result;
    } catch (error) {
      const errorStr = String(error);
      
      // Check if error indicates rate limit
      if (this.isRateLimitError(errorStr)) {
        const fallbackModel = await this.handleRateLimit(taskId);
        if (fallbackModel) {
          return this.executeWithRetry(prompt, context, retryCount, taskId);
        }
      }
      
      if (retryCount < this.retryConfig.maxRetries) {
        const delay = Math.min(
          this.retryConfig.baseDelayMs * Math.pow(2, retryCount),
          this.retryConfig.maxDelayMs
        );
        console.log(`[${this.config.agentId}] Retry ${retryCount + 1}/${this.retryConfig.maxRetries} in ${delay}ms`);
        await this.sleep(delay);
        
        // Try to reinitialize if needed
        if (!this.isReady) {
          try {
            await this.initialize();
          } catch (initError) {
            console.error(`[${this.config.agentId}] Reinit failed:`, initError);
          }
        }
        
        return this.executeWithRetry(prompt, context, retryCount + 1, taskId);
      }
      
      this.recordFailure();
      this.modelManager.recordError(this.currentModelId, false, taskId);
      
      return {
        success: false,
        data: '',
        error: `Execution failed after ${this.retryConfig.maxRetries} retries: ${error}`,
        executionTime: 0,
        retryCount,
        modelUsed: this.currentModelId,
        fallbackUsed: this.currentModelId !== this.originalModelId,
        wasRateLimited: this.isRateLimitError(errorStr)
      };
    }
  }

  private doExecute(prompt: string, context?: string): Promise<CLIResponse> {
    return new Promise((resolve, reject) => {
      this.stopIdleTimer();
      this.startTime = Date.now();
      this.isExecuting = true;
      this.responseBuffer = '';
      this.currentResolve = resolve;
      this.currentReject = reject;

      // Set response timeout
      this.timeoutId = setTimeout(() => {
        if (this.isExecuting) {
          const executionTime = Date.now() - this.startTime;
          console.log(`[${this.config.agentId}] Response timeout after ${executionTime}ms`);
          
          // If we have content, return it as partial success
          if (this.responseBuffer.trim().length > 0) {
            this.finishExecution(true, '[Response timeout - partial result]');
          } else {
            this.finishExecution(false, 'Response timeout with no content');
          }
        }
      }, this.RESPONSE_TIMEOUT);

      // Build the prompt - don't use markers that CLI won't return
      const fullPrompt = context 
        ? `Context:\n${context}\n\n---\n\nTask:\n${prompt}`
        : prompt;

      // Write to CLI
      try {
        this.process!.stdin?.write(fullPrompt + '\n');
      } catch (error) {
        this.cleanupExecution();
        reject(new Error(`Failed to write to CLI: ${error}`));
      }
    });
  }

  private finishExecution(success: boolean, suffix?: string): void {
    if (!this.isExecuting || !this.currentResolve) return;

    const executionTime = Date.now() - this.startTime;
    let cleanResponse = this.responseBuffer.trim();
    
    if (suffix) {
      cleanResponse += `\n${suffix}`;
    }

    const resolve = this.currentResolve;
    this.cleanupExecution();

    resolve({
      success,
      data: cleanResponse,
      executionTime,
      error: success ? undefined : cleanResponse || 'No response received'
    });
  }

  private cleanupExecution(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.silenceTimeoutId) clearTimeout(this.silenceTimeoutId);
    this.isExecuting = false;
    this.currentResolve = null;
    this.currentReject = null;
    this.startIdleTimer();
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    
    if (this.circuitBreaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreaker.state = 'open';
      console.warn(`[${this.config.agentId}] Circuit breaker OPEN after ${this.circuitBreaker.failures} failures`);
      this.emit('circuit_breaker_open', { agentId: this.config.agentId });
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.circuitBreaker.state === 'open') {
      console.log(`[${this.config.agentId}] Circuit breaker open, skipping reconnect`);
      return;
    }
    
    console.log(`[${this.config.agentId}] Attempting reconnection...`);
    this.initAttempts = 0;
    
    try {
      await this.initialize();
      console.log(`[${this.config.agentId}] Reconnection successful`);
      this.emit('reconnected', { agentId: this.config.agentId });
    } catch (error) {
      console.error(`[${this.config.agentId}] Reconnection failed:`, error);
      this.emit('reconnect_failed', { agentId: this.config.agentId, error });
    }
  }

  private startIdleTimer(): void {
    this.stopIdleTimer();
    this.idleTimeoutId = setTimeout(() => {
      console.log(`[${this.config.agentId}] Idle timeout - keeping process alive but marking as idle`);
      this.emit('idle', { agentId: this.config.agentId });
    }, this.IDLE_TIMEOUT);
  }

  private stopIdleTimer(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isExecuting: this.isExecuting,
      bufferSize: this.responseBuffer.length,
      circuitBreakerState: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      currentModel: {
        id: this.currentModelId,
        originalId: this.originalModelId,
        usingFallback: this.currentModelId !== this.originalModelId,
        fallbackAttempts: this.fallbackAttempts
      }
    };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  resetCircuitBreaker(): void {
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: 'closed'
    };
    console.log(`[${this.config.agentId}] Circuit breaker reset`);
  }

  async destroy(): Promise<void> {
    this.stopIdleTimer();
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.silenceTimeoutId) clearTimeout(this.silenceTimeoutId);
    
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
      
      await new Promise<void>(resolve => {
        const forceKillTimeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 2000);
        
        this.process?.on('exit', () => {
          clearTimeout(forceKillTimeout);
          resolve();
        });
      });
    }
    
    this.isReady = false;
    this.removeAllListeners();
  }
}

import { AgentPool } from '../core/AgentPool';
import { MemoryManager } from '../core/MemoryManager';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';

export interface AgentConfig {
  agentType: string;
  model: 'gemini' | 'qwen';
  agentIndex?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface ExecutionResult {
  success: boolean;
  data: string;
  executionTime: number;
  retryCount?: number;
  error?: string;
}

export abstract class BaseCLIAgent extends EventEmitter {
  protected agentPool: AgentPool;
  protected memoryManager: MemoryManager;
  protected db: Database.Database;
  protected config: AgentConfig;
  protected currentExecutionId: number | null = null;
  protected isExecuting: boolean = false;
  protected abortController: AbortController | null = null;

  constructor(
    agentPool: AgentPool, 
    memoryManager: MemoryManager, 
    db: Database.Database, 
    config: AgentConfig
  ) {
    super();
    this.agentPool = agentPool;
    this.memoryManager = memoryManager;
    this.db = db;
    this.config = {
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config
    };
  }

  protected async executePrompt(
    taskId: number,
    phase: string,
    prompt: string,
    context?: string,
    subtaskDescription?: string
  ): Promise<ExecutionResult> {
    const executionId = this.createExecutionRecord(taskId, phase, prompt, subtaskDescription);
    this.currentExecutionId = executionId;
    this.isExecuting = true;
    this.abortController = new AbortController();

    const startTime = Date.now();
    let lastError: string | undefined;
    let retryCount = 0;

    try {
      this.updateExecutionStatus(executionId, 'running', startTime);
      this.emit('execution_started', { taskId, phase, executionId });

      // Retry loop with exponential backoff
      while (retryCount <= (this.config.maxRetries || 3)) {
        if (this.abortController.signal.aborted) {
          throw new Error('Execution aborted');
        }

        try {
          const result = await this.agentPool.executeWithAgent(
            this.config.model, 
            prompt, 
            context
          );

          if (result.success) {
            const executionTime = Date.now() - startTime;
            this.completeExecutionRecord(
              executionId,
              'completed',
              result.data,
              Date.now(),
              executionTime
            );

            this.emit('execution_completed', { 
              taskId, 
              phase, 
              executionId, 
              success: true,
              executionTime 
            });

            return {
              success: true,
              data: result.data,
              executionTime,
              retryCount
            };
          }

          lastError = result.data;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
        }

        retryCount++;
        
        if (retryCount <= (this.config.maxRetries || 3)) {
          const delay = (this.config.retryDelayMs || 1000) * Math.pow(2, retryCount - 1);
          this.emit('execution_retry', { 
            taskId, 
            phase, 
            executionId, 
            retryCount, 
            delay,
            error: lastError 
          });
          await this.sleep(delay);
        }
      }

      // All retries failed
      const executionTime = Date.now() - startTime;
      const errorMessage = `Failed after ${retryCount} attempts: ${lastError}`;
      
      this.completeExecutionRecord(
        executionId, 
        'failed', 
        errorMessage, 
        Date.now(), 
        executionTime
      );

      this.emit('execution_failed', { 
        taskId, 
        phase, 
        executionId, 
        error: errorMessage,
        retryCount 
      });

      return {
        success: false,
        data: errorMessage,
        executionTime,
        retryCount,
        error: lastError
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.completeExecutionRecord(
        executionId, 
        'failed', 
        errorMessage, 
        Date.now(), 
        executionTime
      );

      this.emit('execution_failed', { 
        taskId, 
        phase, 
        executionId, 
        error: errorMessage 
      });

      return {
        success: false,
        data: errorMessage,
        executionTime,
        error: errorMessage
      };
    } finally {
      this.isExecuting = false;
      this.abortController = null;
    }
  }

  /**
   * Abort current execution
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.emit('execution_aborted', { executionId: this.currentExecutionId });
    }
  }

  /**
   * Check if agent is currently executing
   */
  isBusy(): boolean {
    return this.isExecuting;
  }

  private createExecutionRecord(
    taskId: number, 
    phase: string, 
    prompt: string, 
    subtaskDescription?: string
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO agent_executions (
        task_id, agent_type, agent_model, agent_index, 
        phase, subtask_description, prompt_sent, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
    `);
    const result = stmt.run(
      taskId, 
      this.config.agentType, 
      this.config.model, 
      this.config.agentIndex || null, 
      phase, 
      subtaskDescription || null, 
      prompt
    );
    return Number(result.lastInsertRowid);
  }

  private updateExecutionStatus(executionId: number, status: string, startedAt?: number): void {
    const stmt = this.db.prepare(`
      UPDATE agent_executions 
      SET status = ?, started_at = ? 
      WHERE id = ?
    `);
    stmt.run(
      status, 
      startedAt ? new Date(startedAt).toISOString() : null, 
      executionId
    );
  }

  private completeExecutionRecord(
    executionId: number, 
    status: string, 
    response: string, 
    completedAt: number, 
    executionTimeMs: number
  ): void {
    const stmt = this.db.prepare(`
      UPDATE agent_executions 
      SET status = ?, response_received = ?, completed_at = ?, execution_time_ms = ?
      WHERE id = ?
    `);
    stmt.run(
      status, 
      response, 
      new Date(completedAt).toISOString(), 
      executionTimeMs, 
      executionId
    );
  }

  /**
   * Get relevant context for a task using semantic search when available
   */
  protected getRelevantContext(
    taskId: number, 
    contextKeys?: string[], 
    maxLength: number = 6000
  ): string {
    return this.memoryManager.buildContext(taskId, { 
      includeKeys: contextKeys, 
      maxLength, 
      format: 'markdown' 
    });
  }

  /**
   * Get semantically relevant context based on a query
   */
  protected async getSemanticContext(
    taskId: number,
    query: string,
    maxResults: number = 5,
    maxLength: number = 6000
  ): Promise<string> {
    const results = await this.memoryManager.semanticSearch(taskId, query, maxResults);
    
    let context = '';
    for (const result of results) {
      const addition = `## ${result.key} (relevance: ${(result.score * 100).toFixed(1)}%)\n${
        typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)
      }\n\n`;
      
      if (context.length + addition.length <= maxLength) {
        context += addition;
      } else {
        break;
      }
    }
    
    return context;
  }

  protected saveToMemory(taskId: number, key: string, value: unknown): void {
    this.memoryManager.set(taskId, key, value, this.currentExecutionId || undefined);
  }

  protected getFromMemory(taskId: number, key: string): unknown {
    return this.memoryManager.get(taskId, key);
  }

  /**
   * Enhanced JSON extraction with better error handling
   */
  protected extractJSON<T>(text: string): T | null {
    try {
      // Try to find JSON in code blocks first
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        const cleaned = this.cleanJsonString(codeBlockMatch[1].trim());
        return JSON.parse(cleaned) as T;
      }

      // Try to find a JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const cleaned = this.cleanJsonString(jsonMatch[0]);
        return JSON.parse(cleaned) as T;
      }

      // Try to find a JSON array
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const cleaned = this.cleanJsonString(arrayMatch[0]);
        return JSON.parse(cleaned) as T;
      }

      // Try parsing the whole text
      const cleaned = this.cleanJsonString(text);
      return JSON.parse(cleaned) as T;
    } catch (error) {
      this.emit('json_parse_error', { 
        text: text.substring(0, 500), 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Clean JSON string from common issues
   */
  private cleanJsonString(str: string): string {
    return str
      // Remove trailing commas
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      // Fix unquoted keys
      .replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
      // Remove comments
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Fix single quotes
      .replace(/'/g, '"')
      .trim();
  }

  /**
   * Helper to sleep for a given duration
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate that extracted JSON matches expected schema
   */
  protected validateSchema<T>(
    data: unknown, 
    requiredFields: string[]
  ): data is T {
    if (!data || typeof data !== 'object') return false;
    
    for (const field of requiredFields) {
      if (!(field in data)) return false;
    }
    
    return true;
  }

  abstract execute(taskId: number, ...args: unknown[]): Promise<unknown>;
}

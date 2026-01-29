import { AgentPool } from './AgentPool';
import { MemoryManager } from './MemoryManager';
import { EventEmitter } from 'events';
import { VerificationCriteria } from '../agents/CriticAgent';

export interface ParallelTask {
  id: string;
  model: 'gemini' | 'qwen';
  prompt: string;
  context?: string;
  dependencies?: string[];
  verificationCriteria?: VerificationCriteria;
}

export interface TaskResult {
  success: boolean;
  data: string;
  error?: string;
  structuralCheck?: VerificationCheckResult;
  integrationCheck?: VerificationCheckResult;
  executionTime: number;
  retryCount: number;
}

export interface VerificationCheckResult {
  passed: boolean;
  errors: string[];
  timestamp: number;
}

/**
 * Hooks for Triple Check verification
 * Level 1: Structural - Format, JSON validity, code syntax
 * Level 3: Integration - Tests, compilation, system impact
 * (Level 2: Logical is handled by CriticAgent in Orchestrator)
 */
export interface VerificationHooks {
  onStructuralCheck?: (result: string, subtaskId: string) => Promise<VerificationCheckResult>;
  onIntegrationCheck?: (result: string, subtaskId: string) => Promise<VerificationCheckResult>;
}

interface ExecutionConfig {
  maxRetries: number;
  retryDelayMs: number;
  structuralCheckEnabled: boolean;
  integrationCheckEnabled: boolean;
}

const DEFAULT_CONFIG: ExecutionConfig = {
  maxRetries: 2,
  retryDelayMs: 1000,
  structuralCheckEnabled: true,
  integrationCheckEnabled: true
};

/**
 * ParallelExecutor with Triple Check Verification Hooks
 * 
 * Handles parallel task execution with:
 * - Level 1 (Structural) verification before accepting results
 * - Level 3 (Integration) verification for system impact
 * - Automatic retry with error context on failure
 */
export class ParallelExecutor extends EventEmitter {
  private agentPool: AgentPool;
  private memoryManager: MemoryManager;
  private config: ExecutionConfig;

  constructor(
    agentPool: AgentPool, 
    memoryManager: MemoryManager,
    config: Partial<ExecutionConfig> = {}
  ) {
    super();
    this.agentPool = agentPool;
    this.memoryManager = memoryManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a batch of tasks in parallel with verification hooks
   */
  async executeBatch(
    batchId: string, 
    tasks: ParallelTask[],
    hooks?: VerificationHooks
  ): Promise<Map<string, TaskResult>> {
    console.log(`[ParallelExecutor] Ejecutando batch ${batchId} con ${tasks.length} tareas`);
    
    const results = new Map<string, TaskResult>();
    const startTime = Date.now();

    this.emit('batch_started', { batchId, taskCount: tasks.length });

    // Execute all tasks in parallel
    const promises = tasks.map(task => this.executeWithVerification(task, hooks));
    const taskResults = await Promise.allSettled(promises);

    // Process results
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const result = taskResults[i];

      if (result.status === 'fulfilled') {
        results.set(task.id, result.value);
      } else {
        results.set(task.id, {
          success: false,
          data: '',
          error: result.reason?.message || 'Unknown error',
          executionTime: 0,
          retryCount: 0
        });
      }

      this.emit('task_completed', {
        batchId,
        taskId: task.id,
        success: results.get(task.id)?.success || false
      });
    }

    const totalTime = Date.now() - startTime;
    console.log(`[ParallelExecutor] Batch ${batchId} completado en ${totalTime}ms`);
    
    this.emit('batch_completed', { 
      batchId, 
      results: Object.fromEntries(results),
      executionTime: totalTime
    });

    return results;
  }

  /**
   * Execute a single task with verification hooks and retry logic
   */
  private async executeWithVerification(
    task: ParallelTask,
    hooks?: VerificationHooks
  ): Promise<TaskResult> {
    const startTime = Date.now();
    let lastError: string | undefined;
    let retryCount = 0;
    let lastStructuralCheck: VerificationCheckResult | undefined;
    let lastIntegrationCheck: VerificationCheckResult | undefined;

    while (retryCount <= this.config.maxRetries) {
      try {
        // Build prompt with error context if retrying
        const prompt = retryCount > 0 && lastError
          ? this.buildRetryPrompt(task.prompt, lastError, lastStructuralCheck, lastIntegrationCheck)
          : task.prompt;

        // Execute with agent
        const result = await this.agentPool.executeWithAgent(
          task.model,
          prompt,
          task.context
        );

        if (!result.success) {
          lastError = result.data || 'Execution failed';
          retryCount++;
          
          if (retryCount <= this.config.maxRetries) {
            await this.sleep(this.config.retryDelayMs * retryCount);
            continue;
          }
          
          return {
            success: false,
            data: result.data,
            error: lastError,
            executionTime: Date.now() - startTime,
            retryCount
          };
        }

        // Level 1: Structural Check
        if (this.config.structuralCheckEnabled && hooks?.onStructuralCheck) {
          lastStructuralCheck = await hooks.onStructuralCheck(result.data, task.id);
          
          this.emit('structural_check', {
            taskId: task.id,
            passed: lastStructuralCheck.passed,
            errors: lastStructuralCheck.errors
          });

          if (!lastStructuralCheck.passed) {
            lastError = `Structural check failed: ${lastStructuralCheck.errors.join(', ')}`;
            retryCount++;
            
            if (retryCount <= this.config.maxRetries) {
              await this.sleep(this.config.retryDelayMs * retryCount);
              continue;
            }
            
            return {
              success: false,
              data: result.data,
              error: lastError,
              structuralCheck: lastStructuralCheck,
              executionTime: Date.now() - startTime,
              retryCount
            };
          }
        }

        // Level 3: Integration Check
        if (this.config.integrationCheckEnabled && hooks?.onIntegrationCheck) {
          lastIntegrationCheck = await hooks.onIntegrationCheck(result.data, task.id);
          
          this.emit('integration_check', {
            taskId: task.id,
            passed: lastIntegrationCheck.passed,
            errors: lastIntegrationCheck.errors
          });

          if (!lastIntegrationCheck.passed) {
            lastError = `Integration check failed: ${lastIntegrationCheck.errors.join(', ')}`;
            retryCount++;
            
            if (retryCount <= this.config.maxRetries) {
              await this.sleep(this.config.retryDelayMs * retryCount);
              continue;
            }
            
            return {
              success: false,
              data: result.data,
              error: lastError,
              structuralCheck: lastStructuralCheck,
              integrationCheck: lastIntegrationCheck,
              executionTime: Date.now() - startTime,
              retryCount
            };
          }
        }

        // All checks passed
        return {
          success: true,
          data: result.data,
          structuralCheck: lastStructuralCheck,
          integrationCheck: lastIntegrationCheck,
          executionTime: Date.now() - startTime,
          retryCount
        };

      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        retryCount++;
        
        if (retryCount <= this.config.maxRetries) {
          await this.sleep(this.config.retryDelayMs * retryCount);
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      data: '',
      error: lastError || 'Max retries exceeded',
      structuralCheck: lastStructuralCheck,
      integrationCheck: lastIntegrationCheck,
      executionTime: Date.now() - startTime,
      retryCount
    };
  }

  /**
   * Build retry prompt with error context
   */
  private buildRetryPrompt(
    originalPrompt: string,
    error: string,
    structuralCheck?: VerificationCheckResult,
    integrationCheck?: VerificationCheckResult
  ): string {
    const errorContext: string[] = [];
    
    errorContext.push('## RETRY - ERROR EN INTENTO ANTERIOR');
    errorContext.push(`Error: ${error}`);
    
    if (structuralCheck && !structuralCheck.passed) {
      errorContext.push('\n### Errores Estructurales (Nivel 1)');
      structuralCheck.errors.forEach(e => errorContext.push(`- ${e}`));
      errorContext.push('\nDebes corregir estos errores de formato/sintaxis.');
    }
    
    if (integrationCheck && !integrationCheck.passed) {
      errorContext.push('\n### Errores de Integracion (Nivel 3)');
      integrationCheck.errors.forEach(e => errorContext.push(`- ${e}`));
      errorContext.push('\nDebes asegurar que tu codigo compile y no rompa el sistema.');
    }
    
    errorContext.push('\n---\n');

    return errorContext.join('\n') + originalPrompt;
  }

  /**
   * Execute tasks in sequential order (for dependent tasks)
   */
  async executeSequential(
    sequenceId: string,
    tasks: ParallelTask[],
    hooks?: VerificationHooks
  ): Promise<Map<string, TaskResult>> {
    console.log(`[ParallelExecutor] Ejecutando secuencia ${sequenceId} con ${tasks.length} tareas`);
    
    const results = new Map<string, TaskResult>();
    const completedIds = new Set<string>();

    for (const task of tasks) {
      // Check dependencies
      if (task.dependencies) {
        const unmetDeps = task.dependencies.filter(d => !completedIds.has(d));
        if (unmetDeps.length > 0) {
          // Check if any dependency failed
          const failedDeps = unmetDeps.filter(d => {
            const depResult = results.get(d);
            return depResult && !depResult.success;
          });

          if (failedDeps.length > 0) {
            results.set(task.id, {
              success: false,
              data: '',
              error: `Dependencias fallidas: ${failedDeps.join(', ')}`,
              executionTime: 0,
              retryCount: 0
            });
            continue;
          }
        }
      }

      const result = await this.executeWithVerification(task, hooks);
      results.set(task.id, result);
      
      if (result.success) {
        completedIds.add(task.id);
      }

      this.emit('task_completed', {
        sequenceId,
        taskId: task.id,
        success: result.success
      });
    }

    return results;
  }

  /**
   * Built-in structural checks for common formats
   */
  static createDefaultStructuralHook(): (result: string, subtaskId: string) => Promise<VerificationCheckResult> {
    return async (result: string, subtaskId: string): Promise<VerificationCheckResult> => {
      const errors: string[] = [];
      const trimmed = result.trim();

      // Check minimum content
      if (trimmed.length < 10) {
        errors.push('Response is too short');
      }

      // Check for JSON validity if it looks like JSON
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
        } catch {
          // Try to extract from code block
          const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            try {
              JSON.parse(jsonMatch[1].trim());
            } catch (e) {
              errors.push(`Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`);
            }
          } else {
            errors.push('Invalid JSON format');
          }
        }
      }

      // Check for incomplete responses
      if (result.includes('...') && result.endsWith('...')) {
        errors.push('Response appears truncated');
      }

      // Check for placeholder content
      if (/\bTODO\b/i.test(result) || /\bFIXME\b/i.test(result)) {
        errors.push('Contains TODO/FIXME markers');
      }

      // Check for balanced brackets in code
      if (result.includes('function') || result.includes('class') || result.includes('const')) {
        const openBraces = (result.match(/{/g) || []).length;
        const closeBraces = (result.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
          errors.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
        }
      }

      return {
        passed: errors.length === 0,
        errors,
        timestamp: Date.now()
      };
    };
  }

  /**
   * Built-in integration check for TypeScript code
   */
  static createDefaultIntegrationHook(): (result: string, subtaskId: string) => Promise<VerificationCheckResult> {
    return async (result: string, subtaskId: string): Promise<VerificationCheckResult> => {
      const errors: string[] = [];

      // Check for TypeScript compilation issues
      // This is a basic check - in production, you'd run actual tsc
      
      // Check for undefined references
      const undefinedRefs = result.match(/\bundefined\b/g);
      if (undefinedRefs && undefinedRefs.length > 3) {
        errors.push('Multiple undefined references detected');
      }

      // Check for missing imports (basic heuristic)
      const usedTypes = result.match(/:\s*([A-Z][a-zA-Z]+)/g) || [];
      const imports = result.match(/import\s+.*?from/g) || [];
      
      // Check for common errors
      if (result.includes('any') && (result.match(/:\s*any/g) || []).length > 5) {
        errors.push('Excessive use of "any" type');
      }

      // Check for console.log in production code (warning, not error)
      // Skip this check as it's not critical

      return {
        passed: errors.length === 0,
        errors,
        timestamp: Date.now()
      };
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ExecutionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ExecutionConfig {
    return { ...this.config };
  }

  /**
   * Helper to sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

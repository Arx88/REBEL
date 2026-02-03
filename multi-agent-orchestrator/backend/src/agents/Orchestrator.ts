import { BaseCLIAgent } from './BaseCLIAgent';
import { ORCHESTRATOR_PROMPT } from '../prompts';
import { Plan, Phase, SubTask } from '../../../shared/types';
import { normalizeSubtask } from '../core/PlanQuality';
import { ParallelExecutor, VerificationHooks } from '../core/ParallelExecutor';
import { CriticAgent, CriticResult, VerificationCriteria, CriticFeedback } from './CriticAgent';

/**
 * Delegation Contract - The new standard for subtask execution
 * Ensures each agent receives exactly what it needs
 */
export interface DelegationContract {
  subtaskId: string;
  objective: string;           // Clear instruction for the agent
  contextCMN: string;          // Minimal necessary context (from RAG)
  deliverable: string;         // Expected output format
  verificationCriteria: string; // How to verify success
  maxTokens: number;           // Context limit for this subtask
  assignedModel: 'gemini' | 'qwen';
  dependencies: string[];
  files_to_read?: string[];
}

export interface ExecutionResult {
  subtaskId: string;
  success: boolean;
  deliverable: string;
  criticResult?: CriticResult;
  iterations: number;
  executionTime: number;
  model: string;
}

export interface PhaseResult {
  phaseName: string;
  success: boolean;
  subtaskResults: Map<string, ExecutionResult>;
  criticSummary: {
    passed: number;
    failed: number;
    revised: number;
  };
  executionTime: number;
}

export interface OrchestratorResult {
  success: boolean;
  phaseResults: PhaseResult[];
  totalExecutionTime: number;
  totalSubtasks: number;
  passedSubtasks: number;
  failedSubtasks: number;
}

/**
 * Orchestrator - The tactical coordinator
 * 
 * Transforms plan intentions into executable Delegation Contracts,
 * manages CMN injection, and coordinates the verification loop.
 */
export class Orchestrator extends BaseCLIAgent {
  private parallelExecutor: ParallelExecutor;
  private criticAgent: CriticAgent;
  private maxRetryIterations: number = 3;
  private maxReplanAttempts: number = 1;

  constructor(
    agentPool: any, 
    memoryManager: any, 
    db: any, 
    parallelExecutor: ParallelExecutor,
    criticAgent?: CriticAgent
  ) {
    super(agentPool, memoryManager, db, { agentType: 'orchestrator', model: 'gemini' });
    this.parallelExecutor = parallelExecutor;
    this.criticAgent = criticAgent || new CriticAgent(agentPool, memoryManager, db);
  }

  /**
   * Execute a complete plan with Delegation Contracts and Triple Check
   */
  async execute(taskId: number, plan: Plan): Promise<OrchestratorResult> {
    console.log(`[Orchestrator] Ejecutando plan: ${plan.objective}`);
    const startTime = Date.now();
    const phaseResults: PhaseResult[] = [];
    let totalPassed = 0;
    let totalFailed = 0;

    // Store plan in memory for context
    this.memoryManager.set(taskId, 'current_plan', plan, { priority: 'critical' });

    const totalPhases = plan.phases.length;

    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      console.log(`[Orchestrator] Fase ${i + 1}/${plan.phases.length}: ${phase.name}`);
      
      this.emit('phase_started', { taskId, phaseIndex: i, phaseName: phase.name });

      const phaseResult = await this.executePhase(taskId, phase, i, totalPhases);
      phaseResults.push(phaseResult);

      totalPassed += phaseResult.criticSummary.passed;
      totalFailed += phaseResult.criticSummary.failed;

      // Store phase results in memory for subsequent phases
      this.memoryManager.set(taskId, `phase_result_${i}`, {
        phaseName: phase.name,
        success: phaseResult.success,
        summary: this.summarizePhaseResult(phaseResult)
      }, { priority: 'high' });

      this.emit('phase_completed', { 
        taskId, 
        phaseIndex: i, 
        phaseName: phase.name,
        success: phaseResult.success 
      });

      // If phase failed critically, consider stopping
      if (!phaseResult.success && phaseResult.criticSummary.failed > phaseResult.criticSummary.passed) {
        console.log(`[Orchestrator] Fase ${phase.name} falló críticamente, evaluando continuación...`);
        // Continue for now, but log the issue
      }
    }

    const totalTime = Date.now() - startTime;

    return {
      success: phaseResults.every(p => p.success),
      phaseResults,
      totalExecutionTime: totalTime,
      totalSubtasks: totalPassed + totalFailed,
      passedSubtasks: totalPassed,
      failedSubtasks: totalFailed
    };
  }

  /**
   * Execute a single phase with parallel execution and verification
   */
  private async executePhase(
    taskId: number,
    phase: Phase,
    phaseIndex: number,
    totalPhases: number
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    const subtaskResults = new Map<string, ExecutionResult>();
    let passed = 0, failed = 0, revised = 0;
    const totalSubtasks = phase.subtasks.length;
    let completedSubtasks = 0;

    this.emit('phase_progress', {
      taskId,
      phaseIndex,
      phaseName: phase.name,
      totalPhases,
      status: 'starting',
      completedSubtasks,
      totalSubtasks
    });

    const verificationHooks = this.createVerificationHooks(taskId);

    // Generate Delegation Contracts for all subtasks
    const contracts = await this.generateDelegationContracts(taskId, phase, phaseIndex);

    // Group by dependencies for parallel execution
    const executionGroups = this.groupByDependencies(contracts);

    for (const group of executionGroups) {
      // Execute group in parallel
      const parallelTasks = group.map(contract => ({
        id: contract.subtaskId,
        model: contract.assignedModel,
        description: contract.objective,
        assignedAgent: contract.assignedModel,
        prompt: this.buildExecutionPrompt(contract),
        context: contract.contextCMN,
        verificationCriteria: {
          objective: contract.objective,
          deliverable: contract.deliverable,
          verificationCriteria: contract.verificationCriteria,
          subtaskId: contract.subtaskId
        } as VerificationCriteria
      }));

      const batchResults = await this.parallelExecutor.executeBatch(
        `phase_${phaseIndex}_batch`, 
        parallelTasks,
        verificationHooks,
        taskId
      );

      // Process results with critic verification
      for (const [subtaskId, result] of batchResults) {
        const contract = contracts.find(c => c.subtaskId === subtaskId)!;
        let executionResult = await this.verifyAndRetry(
          taskId, 
          result, 
          contract
        );

        if (!executionResult.success) {
          const replannedResult = await this.attemptReplanSubtask(
            taskId,
            phase,
            phaseIndex,
            contract,
            executionResult,
            verificationHooks
          );
          if (replannedResult) {
            executionResult = replannedResult;
          }
        }

        subtaskResults.set(subtaskId, executionResult);
        completedSubtasks += 1;

        this.emit('phase_progress', {
          taskId,
          phaseIndex,
          phaseName: phase.name,
          totalPhases,
          status: executionResult.success ? 'in_progress' : 'failed',
          completedSubtasks,
          totalSubtasks,
          currentSubtask: {
            id: contract.subtaskId,
            description: contract.objective,
            assignedAgent: contract.assignedModel,
            model: contract.assignedModel
          }
        });

        if (executionResult.success) {
          passed++;
          if (executionResult.iterations > 1) revised++;
        } else {
          failed++;
        }

        // Store result in memory for future subtasks
        this.memoryManager.set(taskId, `subtask_result_${subtaskId}`, {
          success: executionResult.success,
          deliverable: executionResult.deliverable.substring(0, 500),
          iterations: executionResult.iterations
        }, { priority: executionResult.success ? 'medium' : 'high' });
      }
    }

    this.emit('phase_progress', {
      taskId,
      phaseIndex,
      phaseName: phase.name,
      totalPhases,
      status: failed === 0 || passed > failed ? 'completed' : 'failed',
      completedSubtasks,
      totalSubtasks
    });

    return {
      phaseName: phase.name,
      success: failed === 0 || passed > failed,
      subtaskResults,
      criticSummary: { passed, failed, revised },
      executionTime: Date.now() - startTime
    };
  }

  /**
   * Generate Delegation Contracts for all subtasks in a phase
   * This is where CMN injection happens
   */
  private async generateDelegationContracts(
    taskId: number, 
    phase: Phase, 
    phaseIndex: number
  ): Promise<DelegationContract[]> {
    const contracts: DelegationContract[] = [];

    for (const subtask of phase.subtasks) {
      contracts.push(await this.createDelegationContract(taskId, phase, subtask));
    }

    return contracts;
  }

  private async createDelegationContract(
    taskId: number,
    phase: Phase,
    subtask: SubTask
  ): Promise<DelegationContract> {
    // Build CMN context using semantic search
    const query = `${subtask.description} ${subtask.deliverable} ${phase.name}`;
    let contextCMN: string;

    try {
      contextCMN = await this.memoryManager.buildCMN(taskId, {
        query,
        maxTokens: this.calculateMaxTokens(subtask),
        includeStructure: subtask.assigned_agent_type === 'implementer',
        priorityBoost: true
      });
    } catch {
      // Fallback to basic context
      contextCMN = this.getRelevantContext(taskId, subtask.required_context, 2000);
    }

    // Add files to read if specified
    if (subtask.files_to_read && subtask.files_to_read.length > 0) {
      contextCMN += `\n\n## Files to analyze\n${subtask.files_to_read.join('\n')}`;
    }

    return {
      subtaskId: subtask.id,
      objective: subtask.description,
      contextCMN,
      deliverable: subtask.deliverable,
      verificationCriteria: subtask.validation_method,
      maxTokens: this.calculateMaxTokens(subtask),
      assignedModel: this.selectModelForSubtask(subtask),
      dependencies: subtask.dependencies,
      files_to_read: subtask.files_to_read
    };
  }

  private async attemptReplanSubtask(
    taskId: number,
    phase: Phase,
    phaseIndex: number,
    contract: DelegationContract,
    executionResult: ExecutionResult,
    verificationHooks: VerificationHooks
  ): Promise<ExecutionResult | null> {
    if (this.maxReplanAttempts < 1 || executionResult.iterations < this.maxRetryIterations) {
      return null;
    }

    const replanKey = `replan_attempt_${contract.subtaskId}`;
    const previousAttempts = this.memoryManager.get(taskId, replanKey) || 0;
    if (previousAttempts >= this.maxReplanAttempts) {
      return null;
    }
    this.memoryManager.set(taskId, replanKey, previousAttempts + 1, { priority: 'low' });

    const replannedSubtask = await this.replanFailedSubtask(taskId, phase, contract, executionResult);
    if (!replannedSubtask) {
      return null;
    }

    const subtaskIndex = phase.subtasks.findIndex(subtask => subtask.id === contract.subtaskId);
    if (subtaskIndex >= 0) {
      phase.subtasks[subtaskIndex] = replannedSubtask;
    }

    const replannedContract = await this.createDelegationContract(taskId, phase, replannedSubtask);
    const replannedBatch = await this.parallelExecutor.executeBatch(
      `phase_${phaseIndex}_replan_${contract.subtaskId}`,
      [
        {
          id: replannedContract.subtaskId,
          model: replannedContract.assignedModel,
          description: replannedContract.objective,
          assignedAgent: replannedContract.assignedModel,
          prompt: this.buildExecutionPrompt(replannedContract),
          context: replannedContract.contextCMN,
          verificationCriteria: {
            objective: replannedContract.objective,
            deliverable: replannedContract.deliverable,
            verificationCriteria: replannedContract.verificationCriteria,
            subtaskId: replannedContract.subtaskId
          } as VerificationCriteria
        }
      ],
      verificationHooks,
      taskId
    );

    const replannedResult = replannedBatch.get(replannedContract.subtaskId);
    if (!replannedResult) {
      return null;
    }

    return this.verifyAndRetry(
      taskId,
      replannedResult,
      replannedContract
    );
  }

  private async replanFailedSubtask(
    taskId: number,
    phase: Phase,
    contract: DelegationContract,
    executionResult: ExecutionResult
  ): Promise<SubTask | null> {
    const prompt = this.buildSubtaskReplanPrompt(phase, contract, executionResult);
    const response = await this.agentPool.executeWithAgent(
      'gemini',
      prompt,
      contract.contextCMN,
      undefined,
      taskId
    );

    if (!response.success) {
      return null;
    }

    const parsed = this.extractJSON<Partial<SubTask>>(response.data);
    if (!parsed) {
      return null;
    }

    const fixes: string[] = [];
    const normalized = normalizeSubtask(parsed, contract.subtaskId, fixes);
    const validIds = new Set(phase.subtasks.map(subtask => subtask.id));
    normalized.dependencies = normalized.dependencies.filter(dep => dep !== normalized.id && validIds.has(dep));

    return normalized;
  }

  private buildSubtaskReplanPrompt(
    phase: Phase,
    contract: DelegationContract,
    executionResult: ExecutionResult
  ): string {
    return `
Eres un planificador que debe corregir UNA subtarea fallida sin replanificar todo el plan.

## CONTEXTO
Fase: ${phase.name}

Subtarea actual:
- ID: ${contract.subtaskId}
- Objetivo: ${contract.objective}
- Deliverable: ${contract.deliverable}
- Criterios de verificación: ${contract.verificationCriteria}
- Dependencias: ${contract.dependencies.join(', ') || 'Ninguna'}

Resultado fallido:
- Exitoso: ${executionResult.success ? 'Sí' : 'No'}
- Iteraciones: ${executionResult.iterations}
- Salida/Error: ${executionResult.deliverable.substring(0, 500)}

## INSTRUCCIONES
Proporciona una versión mejorada de ESTA subtarea (solo este nodo) con:
- description (más clara y accionable)
- deliverable (completo y verificable)
- validation_method (prueba ejecutable)
- assigned_agent_type (researcher | implementer | analyzer)
- estimated_complexity (1-10)
- dependencies (solo IDs existentes si aplica)
- files_to_read (si aplica)
- required_context (si aplica)

Responde SOLO con JSON.
    `.trim();
  }

  /**
   * Verify result with CriticAgent and retry if needed
   */
  private async verifyAndRetry(
    taskId: number,
    initialResult: { success: boolean; data: string; error?: string },
    contract: DelegationContract
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    let currentResult = initialResult;
    let iteration = 1;
    let lastCriticResult: CriticResult | undefined;
    let previousFeedback: CriticFeedback | undefined;

    while (iteration <= this.maxRetryIterations) {
      // If structural check already failed, no need for critic
      if (!currentResult.success) {
        return {
          subtaskId: contract.subtaskId,
          success: false,
          deliverable: currentResult.error || currentResult.data,
          criticResult: lastCriticResult,
          iterations: iteration,
          executionTime: Date.now() - startTime,
          model: contract.assignedModel
        };
      }

      // Run critic verification (Level 2 - Logical Check)
      const criticResult = await this.criticAgent.execute(
        taskId,
        currentResult.data,
        {
          objective: contract.objective,
          deliverable: contract.deliverable,
          verificationCriteria: contract.verificationCriteria,
          subtaskId: contract.subtaskId
        },
        previousFeedback
      );

      lastCriticResult = criticResult;

      this.emit('critic_verification', {
        taskId,
        subtaskId: contract.subtaskId,
        verdict: criticResult.verdict,
        iteration
      });

      if (criticResult.verdict === 'PASS') {
        return {
          subtaskId: contract.subtaskId,
          success: true,
          deliverable: currentResult.data,
          criticResult,
          iterations: iteration,
          executionTime: Date.now() - startTime,
          model: contract.assignedModel
        };
      }

      // Check if we should retry
      if (!this.criticAgent.shouldRetry(criticResult, iteration)) {
        return {
          subtaskId: contract.subtaskId,
          success: false,
          deliverable: currentResult.data,
          criticResult,
          iterations: iteration,
          executionTime: Date.now() - startTime,
          model: contract.assignedModel
        };
      }

      // Generate feedback and retry
      previousFeedback = this.criticAgent.generateFeedback(
        contract.subtaskId, 
        criticResult, 
        iteration
      );

      console.log(`[Orchestrator] Reintentando subtarea ${contract.subtaskId} (iteración ${iteration + 1})`);

      // Re-execute with feedback
      const retryPrompt = this.buildRetryPrompt(contract, previousFeedback);
      const retryResult = await this.agentPool.executeWithAgent(
        contract.assignedModel,
        retryPrompt,
        contract.contextCMN,
        undefined,
        taskId
      );

      currentResult = retryResult;
      iteration++;
    }

    // Max iterations reached
    return {
      subtaskId: contract.subtaskId,
      success: false,
      deliverable: currentResult.data,
      criticResult: lastCriticResult,
      iterations: iteration,
      executionTime: Date.now() - startTime,
      model: contract.assignedModel
    };
  }

  /**
   * Build execution prompt from Delegation Contract
   */
  private buildExecutionPrompt(contract: DelegationContract): string {
    return `
# CONTRATO DE DELEGACION

## Objetivo
${contract.objective}

## Deliverable Esperado
${contract.deliverable}

## Criterios de Verificacion
${contract.verificationCriteria}

${contract.files_to_read && contract.files_to_read.length > 0 ? `
## Archivos a Revisar
${contract.files_to_read.join('\n')}
` : ''}

## Contexto (CMN)
${contract.contextCMN}

---

## INSTRUCCIONES

1. Lee cuidadosamente el objetivo y el contexto proporcionado
2. Implementa/Analiza exactamente lo que se pide
3. Asegurate de cumplir con TODOS los criterios de verificacion
4. Tu respuesta debe ser el deliverable completo, no parcial
5. Si generas codigo, debe ser completo y funcional

## TU RESPUESTA

Genera el deliverable especificado. Si es codigo, incluye todo el contenido del archivo.
Si es analisis, estructura tu respuesta en JSON.
    `.trim();
  }

  /**
   * Build retry prompt with critic feedback
   */
  private buildRetryPrompt(contract: DelegationContract, feedback: CriticFeedback): string {
    return `
# CORRECCION REQUERIDA

Tu respuesta anterior no paso la verificacion. Debes corregir los problemas indicados.

## Feedback del Critic
${feedback.feedbackForAgent}

## Cambios Requeridos
${feedback.requiredChanges.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

## CONTRATO ORIGINAL

### Objetivo
${contract.objective}

### Deliverable Esperado
${contract.deliverable}

### Criterios de Verificacion
${contract.verificationCriteria}

### Contexto (CMN)
${contract.contextCMN}

---

## INSTRUCCIONES

1. Revisa el feedback cuidadosamente
2. Corrige TODOS los problemas mencionados
3. Mantén lo que estaba correcto
4. Verifica que cumples con los criterios de verificacion

## TU RESPUESTA CORREGIDA
    `.trim();
  }

  /**
   * Create verification hooks for ParallelExecutor
   */
  private createVerificationHooks(taskId: number): VerificationHooks {
    return {
      onStructuralCheck: async (result, subtaskId) => {
        // Level 1: Structural verification
        return this.performStructuralCheck(result, subtaskId);
      },
      onIntegrationCheck: async (result, subtaskId) => {
        // Level 3: Integration verification (tests, compilation)
        return this.performIntegrationCheck(result, subtaskId);
      }
    };
  }

  /**
   * Level 1: Structural Check - Format validation
   */
  private async performStructuralCheck(result: string, subtaskId: string): Promise<{
    passed: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check for valid JSON if it looks like JSON
    if (result.trim().startsWith('{') || result.trim().startsWith('[')) {
      try {
        JSON.parse(result);
      } catch {
        // Try to extract JSON from code blocks
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            JSON.parse(jsonMatch[1]);
          } catch (e) {
            errors.push(`Invalid JSON structure: ${e}`);
          }
        }
      }
    }

    // Check for common code issues
    if (result.includes('// TODO') || result.includes('// FIXME')) {
      errors.push('Contains unresolved TODO/FIXME comments');
    }

    if (result.includes('undefined') && result.includes('function')) {
      // Might be uninitialized variables in code
    }

    // Check minimum length
    if (result.trim().length < 50) {
      errors.push('Response too short - likely incomplete');
    }

    return {
      passed: errors.length === 0,
      errors
    };
  }

  /**
   * Level 3: Integration Check - Tests and compilation
   */
  private async performIntegrationCheck(result: string, subtaskId: string): Promise<{
    passed: boolean;
    errors: string[];
  }> {
    // For now, just do basic checks
    // TODO: Integrate with actual test runner and TypeScript compiler
    const errors: string[] = [];

    // Check for TypeScript syntax issues
    const tsErrors = this.checkTypescriptSyntax(result);
    errors.push(...tsErrors);

    return {
      passed: errors.length === 0,
      errors
    };
  }

  /**
   * Basic TypeScript syntax checking
   */
  private checkTypescriptSyntax(code: string): string[] {
    const errors: string[] = [];

    // Check for unmatched brackets
    const brackets = { '{': 0, '[': 0, '(': 0 };
    for (const char of code) {
      if (char === '{') brackets['{']++;
      if (char === '}') brackets['{']--;
      if (char === '[') brackets['[']++;
      if (char === ']') brackets['[']--;
      if (char === '(') brackets['(']++;
      if (char === ')') brackets['(']--;
    }

    if (brackets['{'] !== 0) errors.push('Unmatched curly braces');
    if (brackets['['] !== 0) errors.push('Unmatched square brackets');
    if (brackets['('] !== 0) errors.push('Unmatched parentheses');

    return errors;
  }

  /**
   * Calculate max tokens based on subtask complexity
   */
  private calculateMaxTokens(subtask: SubTask): number {
    const baseTokens = 1500;
    const complexityMultiplier = Math.min(subtask.estimated_complexity, 10) / 5;
    return Math.floor(baseTokens * (1 + complexityMultiplier));
  }

  /**
   * Select appropriate model for subtask type
   */
  private selectModelForSubtask(subtask: SubTask): 'gemini' | 'qwen' {
    const type = subtask.assigned_agent_type;
    
    // Qwen for code generation, Gemini for analysis
    if (type === 'implementer') return 'qwen';
    if (type === 'researcher' || type === 'analyzer') return 'gemini';
    
    // Default based on complexity
    return subtask.estimated_complexity > 5 ? 'gemini' : 'qwen';
  }

  /**
   * Group contracts by dependencies for parallel execution
   */
  private groupByDependencies(contracts: DelegationContract[]): DelegationContract[][] {
    const groups: DelegationContract[][] = [];
    const completed = new Set<string>();
    const remaining = [...contracts];

    while (remaining.length > 0) {
      const canExecute = remaining.filter(c => 
        c.dependencies.every(dep => completed.has(dep))
      );

      if (canExecute.length === 0) {
        // Circular dependency or missing deps - execute remaining sequentially
        groups.push(remaining);
        break;
      }

      groups.push(canExecute);
      canExecute.forEach(c => {
        completed.add(c.subtaskId);
        const idx = remaining.indexOf(c);
        if (idx > -1) remaining.splice(idx, 1);
      });
    }

    return groups;
  }

  /**
   * Summarize phase result for memory
   */
  private summarizePhaseResult(result: PhaseResult): string {
    const lines = [
      `Phase: ${result.phaseName}`,
      `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
      `Subtasks: ${result.criticSummary.passed} passed, ${result.criticSummary.failed} failed`,
      `Execution time: ${result.executionTime}ms`
    ];

    if (result.criticSummary.revised > 0) {
      lines.push(`Revisions: ${result.criticSummary.revised} subtasks required revision`);
    }

    return lines.join('\n');
  }
}

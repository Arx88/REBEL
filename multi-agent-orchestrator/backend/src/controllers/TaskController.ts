import { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { AgentPool } from '../core/AgentPool';
import { MemoryManager } from '../core/MemoryManager';
import { ParallelExecutor } from '../core/ParallelExecutor';
import { MasterPlanner } from '../agents/MasterPlanner';
import { PlanValidator } from '../agents/PlanValidator';
import { PlanRefiner } from '../agents/PlanRefiner';
import { Orchestrator } from '../agents/Orchestrator';
import { Synthesizer } from '../agents/Synthesizer';
import { socketManager } from '../websocket/socketManager';
import { 
  createTask, 
  updateTaskStatus, 
  getTask, 
  getTasks, 
  addTimelineEvent, 
  getTimelineEvents, 
  getTaskExecutions,
  getTaskStats
} from '../database/db';
import { 
  Plan, 
  PlanApprovalResponse 
} from '../../shared/types';

interface PendingApproval {
  taskId: number;
  plan: Plan;
  validatorFeedback: any;
  userInput: string;
  context?: string;
  createdAt: Date;
  attempts: number;
}

export class TaskController {
  private db: Database.Database;
  private agentPool: AgentPool;
  private memoryManager: MemoryManager;
  private parallelExecutor: ParallelExecutor;
  private masterPlanner: MasterPlanner;
  private planValidator: PlanValidator;
  private planRefiner: PlanRefiner;
  private orchestrator: Orchestrator;
  private synthesizer: Synthesizer;
  
  // Pending approvals map
  private pendingApprovals: Map<number, PendingApproval> = new Map();
  
  // Auto-approve setting (can be overridden per task)
  private defaultAutoApprove: boolean = false;
  
  // Refinement settings
  private enablePlanRefinement: boolean = true;
  private maxRefinementIterations: number = 3;

  constructor(db: Database.Database, agentPool: AgentPool, memoryManager: MemoryManager) {
    this.db = db;
    this.agentPool = agentPool;
    this.memoryManager = memoryManager;
    this.parallelExecutor = new ParallelExecutor(agentPool, memoryManager);
    this.masterPlanner = new MasterPlanner(agentPool, memoryManager, db);
    this.planValidator = new PlanValidator(agentPool, memoryManager, db);
    this.planRefiner = new PlanRefiner(agentPool, memoryManager, db);
    this.orchestrator = new Orchestrator(agentPool, memoryManager, db, this.parallelExecutor);
    this.synthesizer = new Synthesizer(agentPool, memoryManager, db);

    this.parallelExecutor.on('subtask_started', (data: any) => {
      if (!data.taskId) return;
      socketManager.notifySubtaskExecution(data.taskId, {
        subtaskId: data.subtaskId,
        description: data.description || data.subtaskId,
        phase: 'execution',
        assignedAgent: data.assignedAgent || data.model,
        model: data.model,
        status: 'starting',
        attempt: data.attempt,
        maxAttempts: data.maxAttempts
      });
    });

    this.parallelExecutor.on('subtask_retry', (data: any) => {
      if (!data.taskId) return;
      socketManager.notifySubtaskExecution(data.taskId, {
        subtaskId: data.subtaskId,
        description: data.description || data.subtaskId,
        phase: 'execution',
        assignedAgent: data.assignedAgent || data.model,
        model: data.model,
        status: 'retrying',
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
        error: data.error
      });
    });

    this.parallelExecutor.on('subtask_completed', (data: any) => {
      if (!data.taskId) return;
      socketManager.notifySubtaskExecution(data.taskId, {
        subtaskId: data.subtaskId,
        description: data.description || data.subtaskId,
        phase: 'execution',
        assignedAgent: data.assignedAgent || data.model,
        model: data.model,
        status: data.success ? 'completed' : 'failed',
        executionTimeMs: data.executionTimeMs,
        result: data.outputPreview ? { success: data.success, outputPreview: data.outputPreview } : undefined,
        error: data.error
      });
    });

    this.orchestrator.on('phase_started', ({ taskId, phaseIndex, phaseName }: any) => {
      this.recordTimeline(
        taskId,
        'phase_start',
        `Fase ${phaseIndex + 1}: ${phaseName}`
      );
    });

    this.orchestrator.on('phase_completed', ({ taskId, phaseIndex, phaseName, success }: any) => {
      this.recordTimeline(
        taskId,
        success ? 'phase_completed' : 'phase_failed',
        `Fase ${phaseIndex + 1}: ${phaseName} ${success ? 'completada' : 'fallida'}`
      );
    });

    this.orchestrator.on('phase_progress', (data: any) => {
      socketManager.notifyPhaseProgress(data.taskId, {
        phaseIndex: data.phaseIndex,
        phaseName: data.phaseName,
        totalPhases: data.totalPhases,
        status: data.status,
        completedSubtasks: data.completedSubtasks,
        totalSubtasks: data.totalSubtasks,
        currentSubtask: data.currentSubtask
      });
    });
  }

  // ============================================
  // TASK CREATION
  // ============================================

  async createTask(req: Request, res: Response): Promise<void> {
    try {
      const { userInput, context, autoApprove } = req.body;
      
      if (!userInput) {
        res.status(400).json({ success: false, error: 'Se requiere userInput' });
        return;
      }

      const taskId = createTask(this.db, userInput, context);
      console.log(`[TaskController] Tarea creada: ${taskId}`);

      res.status(201).json({ 
        success: true, 
        taskId, 
        message: 'Tarea creada. Se generará un plan para tu aprobación.',
        status: 'planning' 
      });

      // Start processing with auto-approve setting
      this.processTask(taskId, userInput, context, autoApprove ?? this.defaultAutoApprove);

    } catch (error) {
      console.error('[TaskController] Error:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  // ============================================
  // MAIN PROCESSING FLOW
  // ============================================

  private async processTask(
    taskId: number, 
    userInput: string, 
    context?: string,
    autoApprove: boolean = false
  ): Promise<void> {
    try {
      // FASE 1: PLANNING
      let plan = await this.runPlanningPhase(taskId, userInput, context);
      
      if (!plan) {
        throw new Error('No se pudo generar un plan válido');
      }

      // FASE 1.5: PLAN REFINEMENT (Multi-agent iterative improvement)
      if (this.enablePlanRefinement) {
        const refinedPlan = await this.runPlanRefinementPhase(taskId, plan, userInput, context);
        if (refinedPlan) {
          plan = refinedPlan;
        }
      }

      // FASE 2: VALIDATION
      const validationResult = await this.runPlanValidationPhase(taskId, userInput, plan, context);
      
      // FASE 3: APPROVAL (Human-in-the-Loop)
      if (autoApprove && validationResult.approved) {
        console.log(`[TaskController] Auto-aproving plan for task ${taskId}`);
        this.recordTimeline(taskId, 'auto_approved', 'Plan auto-aprobado');
        await this.continueAfterApproval(taskId, plan);
      } else {
        // Wait for user approval
        await this.requestUserApproval(taskId, plan, validationResult, userInput, context);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      console.error(`[TaskController] Error processing task ${taskId}:`, error);
      
      updateTaskStatus(this.db, taskId, 'failed', { error_message: errorMessage });
      this.recordTimeline(taskId, 'error', 'Error en procesamiento', { error: errorMessage });
      socketManager.notifyError(taskId, errorMessage);
    }
  }

  private recordTimeline(taskId: number, eventType: string, message: string, details?: any): void {
    this.recordTimelineEvent(taskId, eventType, message, details);
  }

  private recordTimelineEvent(taskId: number, eventType: string, message: string, details?: any): void {
    addTimelineEvent(this.db, taskId, eventType, message, details);
    socketManager.notifyTimelineEvent({
      id: `${taskId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: eventType,
      taskId: String(taskId),
      message,
      details
    });
  }

  // ============================================
  // PHASE 1: PLANNING
  // ============================================

  private async runPlanningPhase(
    taskId: number, 
    userInput: string, 
    context?: string
  ): Promise<Plan | null> {
    console.log(`[TaskController] Fase 1: Planning for task ${taskId}`);
    
    updateTaskStatus(this.db, taskId, 'planning');
    socketManager.notifyTaskStatusChange(taskId, 'planning');
    this.recordTimeline(taskId, 'phase_start', 'Iniciando planificación');

    const planningResult = await this.masterPlanner.execute(taskId, userInput, context || '');

    if (!planningResult.success || !planningResult.plan) {
      this.recordTimeline(taskId, 'error', 'Error generando plan', { 
        error: planningResult.error || 'Plan no válido' 
      });
      return null;
    }

    // Save plan to database
    this.db.prepare(`
      INSERT INTO plans (task_id, plan_json, validation_status) 
      VALUES (?, ?, 'pending')
    `).run(taskId, JSON.stringify(planningResult.plan));

    this.recordTimeline(taskId, 'plan_generated', 'Plan generado exitosamente');
    socketManager.broadcastToTask(taskId, { 
      type: 'plan_generated', 
      payload: { plan: planningResult.plan } 
    });

    return planningResult.plan;
  }

  // ============================================
  // PHASE 1.5: PLAN REFINEMENT
  // ============================================

  private async runPlanRefinementPhase(
    taskId: number,
    plan: Plan,
    userInput: string,
    context?: string
  ): Promise<Plan | null> {
    console.log(`[TaskController] Phase 1.5: Plan Refinement for task ${taskId}`);
    
    updateTaskStatus(this.db, taskId, 'refining_plan' as any);
    socketManager.notifyTaskStatusChange(taskId, 'refining_plan');
    this.recordTimeline(taskId, 'phase_start', 'Iniciando refinamiento iterativo del plan');

    try {
      const refinementResult = await this.planRefiner.execute(
        taskId,
        plan,
        userInput,
        context || '',
        this.maxRefinementIterations
      );

      if (refinementResult.success) {
        // Save refined plan
        this.db.prepare(`
          UPDATE plans 
          SET plan_json = ?, refinement_iterations = ?, refinement_score = ?
          WHERE task_id = ?
        `).run(
          JSON.stringify(refinementResult.refinedPlan),
          refinementResult.iteration,
          refinementResult.finalScore,
          taskId
        );

        this.recordTimeline(taskId, 'plan_refined', 
          `Plan refinado: ${refinementResult.improvements.length} mejoras aplicadas. Score: ${refinementResult.originalScore.toFixed(1)} -> ${refinementResult.finalScore.toFixed(1)}`,
          { 
            improvements: refinementResult.improvements,
            agentContributions: refinementResult.agentContributions,
            scoreImprovement: refinementResult.finalScore - refinementResult.originalScore
          }
        );

        socketManager.broadcastToTask(taskId, {
          type: 'plan_refined',
          payload: {
            taskId,
            originalPlan: plan,
            refinedPlan: refinementResult.refinedPlan,
            improvements: refinementResult.improvements,
            scoreChange: {
              before: refinementResult.originalScore,
              after: refinementResult.finalScore
            },
            agentContributions: refinementResult.agentContributions
          }
        });

        return refinementResult.refinedPlan;
      }
    } catch (error) {
      console.warn(`[TaskController] Plan refinement failed, continuing with original plan:`, error);
      this.recordTimeline(taskId, 'warning', 'Refinamiento falló, usando plan original');
    }

    return plan; // Return original plan if refinement fails
  }

  // ============================================
  // PHASE 2: VALIDATION
  // ============================================

  private async runPlanValidationPhase(
    taskId: number, 
    userInput: string, 
    plan: Plan, 
    context?: string
  ): Promise<{ approved: boolean; confidence: number; issues: string[]; suggestions: string[] }> {
    console.log(`[TaskController] Fase 2: Validation for task ${taskId}`);
    
    updateTaskStatus(this.db, taskId, 'validating_plan');
    socketManager.notifyTaskStatusChange(taskId, 'validating_plan');

    const validationResult = await this.planValidator.execute(taskId, plan, userInput, context || '');

    // Update plan validation status
    this.db.prepare(`
      UPDATE plans 
      SET validation_status = ?, confidence_score = ?, validator_feedback = ?
      WHERE task_id = ?
    `).run(
      validationResult.approved ? 'approved' : 'needs_review',
      validationResult.confidence,
      JSON.stringify({
        issues: validationResult.issues,
        suggestions: validationResult.suggestions
      }),
      taskId
    );

    this.recordTimeline(
      this.db, 
      taskId, 
      validationResult.approved ? 'plan_validated' : 'plan_needs_review',
      validationResult.approved 
        ? `Plan validado (confianza: ${validationResult.confidence}%)` 
        : `Plan requiere revisión (${validationResult.issues.length} problemas encontrados)`,
      { validation: validationResult }
    );

    return validationResult;
  }

  // ============================================
  // PHASE 3: USER APPROVAL (Human-in-the-Loop)
  // ============================================

  private async requestUserApproval(
    taskId: number,
    plan: Plan,
    validatorFeedback: any,
    userInput: string,
    context?: string
  ): Promise<void> {
    console.log(`[TaskController] Requesting user approval for task ${taskId}`);
    
    // Update status to awaiting approval
    updateTaskStatus(this.db, taskId, 'awaiting_approval');
    socketManager.notifyTaskStatusChange(taskId, 'awaiting_approval');
    
    // Store pending approval
    this.pendingApprovals.set(taskId, {
      taskId,
      plan,
      validatorFeedback,
      userInput,
      context,
      createdAt: new Date(),
      attempts: 0
    });

    // Add timeline event
    this.recordTimeline(
      this.db, 
      taskId, 
      'approval_needed', 
      'Plan listo para revisión. Esperando aprobación del usuario.',
      { 
        plan,
        validatorFeedback,
        needsApproval: true
      }
    );

    // Notify via WebSocket
    socketManager.broadcastToTask(taskId, {
      type: 'plan_needs_approval',
      payload: {
        taskId,
        plan,
        validatorFeedback,
        message: validatorFeedback.approved 
          ? 'El plan ha sido validado automáticamente. ¿Deseas aprobarlo o hacer modificaciones?'
          : `El validador encontró ${validatorFeedback.issues?.length || 0} problema(s). Revisa el plan antes de aprobar.`,
        suggestedActions: ['approve', 'reject', 'modify']
      }
    });
  }

  // ============================================
  // APPROVAL HANDLERS (Called from routes)
  // ============================================

  async handlePlanApproval(req: Request, res: Response): Promise<void> {
    try {
      const taskId = parseInt(req.params.id);
      const { action, feedback, modifications } = req.body as PlanApprovalResponse;

      if (isNaN(taskId)) {
        res.status(400).json({ success: false, error: 'ID de tarea inválido' });
        return;
      }

      const pendingApproval = this.pendingApprovals.get(taskId);
      
      if (!pendingApproval) {
        // Check if task exists and is in correct state
        const task = getTask(this.db, taskId);
        if (!task) {
          res.status(404).json({ success: false, error: 'Tarea no encontrada' });
          return;
        }
        if (task.status !== 'awaiting_approval') {
          res.status(400).json({ 
            success: false, 
            error: `Tarea no está esperando aprobación. Estado actual: ${task.status}` 
          });
          return;
        }
        res.status(400).json({ success: false, error: 'No hay aprobación pendiente para esta tarea' });
        return;
      }

      switch (action) {
        case 'approve':
          await this.approveTask(taskId, pendingApproval, feedback);
          res.json({ 
            success: true, 
            message: 'Plan aprobado. Iniciando ejecución.',
            status: 'orchestrating'
          });
          break;

        case 'reject':
          await this.rejectTask(taskId, feedback);
          res.json({ 
            success: true, 
            message: 'Plan rechazado. Tarea cancelada.',
            status: 'cancelled'
          });
          break;

        case 'modify':
          await this.requestPlanModification(taskId, pendingApproval, feedback, modifications);
          res.json({ 
            success: true, 
            message: 'Solicitud de modificación recibida. Re-planificando...',
            status: 'planning'
          });
          break;

        default:
          res.status(400).json({ success: false, error: 'Acción no válida. Usa: approve, reject, o modify' });
      }

    } catch (error) {
      console.error('[TaskController] Error handling approval:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  private async approveTask(taskId: number, pendingApproval: PendingApproval, feedback?: string): Promise<void> {
    console.log(`[TaskController] Plan approved for task ${taskId}`);
    
    // Remove from pending
    this.pendingApprovals.delete(taskId);
    
    // Update database
    this.db.prepare(`
      UPDATE plans SET validation_status = 'user_approved' WHERE task_id = ?
    `).run(taskId);
    
    if (feedback) {
      this.db.prepare(`
        UPDATE tasks SET user_feedback = ? WHERE id = ?
      `).run(feedback, taskId);
    }

    this.recordTimeline(taskId, 'user_approved', 'Plan aprobado por el usuario', { feedback });
    
    socketManager.broadcastToTask(taskId, {
      type: 'approval_received',
      payload: { taskId, action: 'approve', feedback }
    });

    // Continue with execution
    await this.continueAfterApproval(taskId, pendingApproval.plan);
  }

  private async rejectTask(taskId: number, feedback?: string): Promise<void> {
    console.log(`[TaskController] Plan rejected for task ${taskId}`);
    
    // Remove from pending
    this.pendingApprovals.delete(taskId);
    
    // Update status
    updateTaskStatus(this.db, taskId, 'cancelled', { 
      user_feedback: feedback,
      error_message: 'Plan rechazado por el usuario'
    });
    
    this.db.prepare(`
      UPDATE plans SET validation_status = 'user_rejected' WHERE task_id = ?
    `).run(taskId);

    this.recordTimeline(taskId, 'user_rejected', 'Plan rechazado por el usuario', { feedback });
    
    socketManager.broadcastToTask(taskId, {
      type: 'approval_received',
      payload: { taskId, action: 'reject', feedback }
    });
    
    socketManager.notifyTaskStatusChange(taskId, 'cancelled');
  }

  private async requestPlanModification(
    taskId: number, 
    pendingApproval: PendingApproval,
    feedback?: string,
    modifications?: Partial<Plan>
  ): Promise<void> {
    console.log(`[TaskController] Plan modification requested for task ${taskId}`);
    
    pendingApproval.attempts++;
    
    if (pendingApproval.attempts >= 3) {
      this.recordTimeline(taskId, 'warning', 'Máximo de modificaciones alcanzado (3 intentos)');
    }

    this.recordTimeline(taskId, 'modification_requested', 'Usuario solicitó modificaciones al plan', { 
      feedback,
      modifications,
      attempt: pendingApproval.attempts
    });
    
    socketManager.broadcastToTask(taskId, {
      type: 'approval_received',
      payload: { taskId, action: 'modify', feedback }
    });

    // Remove current pending approval
    this.pendingApprovals.delete(taskId);

    // Restart planning with feedback
    const enhancedContext = `
FEEDBACK DEL USUARIO SOBRE EL PLAN ANTERIOR:
${feedback || 'Sin feedback específico'}

MODIFICACIONES SOLICITADAS:
${modifications ? JSON.stringify(modifications, null, 2) : 'Sin modificaciones específicas'}

PLAN ANTERIOR (RECHAZADO):
${JSON.stringify(pendingApproval.plan, null, 2)}

Por favor genera un nuevo plan que incorpore este feedback.
---
CONTEXTO ORIGINAL:
${pendingApproval.context || ''}
    `.trim();

    // Restart the process
    this.processTask(taskId, pendingApproval.userInput, enhancedContext, false);
  }

  // ============================================
  // PHASE 4: ORCHESTRATION (After Approval)
  // ============================================

  private async continueAfterApproval(taskId: number, plan: Plan): Promise<void> {
    try {
      // FASE 4: ORQUESTACIÓN
      await this.runOrchestrationPhase(taskId, plan);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error';
      updateTaskStatus(this.db, taskId, 'failed', { error_message: errorMessage });
      this.recordTimeline(taskId, 'error', 'Error en ejecución', { error: errorMessage });
      socketManager.notifyError(taskId, errorMessage);
    }
  }

  private async runOrchestrationPhase(taskId: number, plan: Plan): Promise<void> {
    console.log(`[TaskController] Fase 4: Orchestration for task ${taskId}`);
    
    updateTaskStatus(this.db, taskId, 'orchestrating');
    socketManager.notifyTaskStatusChange(taskId, 'orchestrating');
    this.recordTimeline(taskId, 'phase_start', 'Iniciando orquestación de agentes');

    const orchestrationResult = await this.orchestrator.execute(taskId, plan);

    // Check if orchestration succeeded
    if (!orchestrationResult.success) {
      throw new Error(orchestrationResult.error || 'Error en orquestación');
    }

    // FASE 5: SÍNTESIS
    await this.runSynthesisPhase(taskId, plan, orchestrationResult);
  }

  // ============================================
  // PHASE 5: SYNTHESIS
  // ============================================

  private async runSynthesisPhase(taskId: number, plan: Plan, orchestrationResult: any): Promise<void> {
    console.log(`[TaskController] Fase 5: Synthesis for task ${taskId}`);
    
    updateTaskStatus(this.db, taskId, 'synthesizing');
    socketManager.notifyTaskStatusChange(taskId, 'synthesizing');
    this.recordTimeline(taskId, 'phase_start', 'Sintetizando resultados');

    const memoryData = this.memoryManager.getAll(taskId);
    
    const finalReport = await this.synthesizer.generateFinalReport(
      taskId,
      plan.objective,
      JSON.stringify(orchestrationResult.phaseResults),
      JSON.stringify(memoryData)
    );

    // Complete task
    updateTaskStatus(this.db, taskId, 'completed', { final_result: finalReport.completeReport });
    this.recordTimeline(taskId, 'task_completed', 'Tarea completada exitosamente');
    
    socketManager.notifyTaskComplete(taskId, { 
      report: finalReport,
      duration: Date.now() - new Date(getTask(this.db, taskId).created_at).getTime()
    });

    console.log(`[TaskController] Task ${taskId} completed successfully`);
  }

  // ============================================
  // TASK MANAGEMENT ENDPOINTS
  // ============================================

  getTask(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      if (isNaN(taskId)) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }

      const task = getTask(this.db, taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Tarea no encontrada' });
        return;
      }

      const plan = this.db.prepare(`
        SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1
      `).get(taskId) as any;
      
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total, 
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(execution_time_ms) as avg_time
        FROM agent_executions WHERE task_id = ?
      `).get(taskId);

      // Include pending approval info if applicable
      const pendingApproval = this.pendingApprovals.get(taskId);

      res.json({ 
        success: true, 
        task: { 
          ...task, 
          plan: plan ? JSON.parse(plan.plan_json) : null,
          planValidation: plan ? {
            status: plan.validation_status,
            confidence: plan.confidence_score,
            feedback: plan.validator_feedback ? JSON.parse(plan.validator_feedback) : null
          } : null,
          stats,
          pendingApproval: pendingApproval ? {
            createdAt: pendingApproval.createdAt,
            attempts: pendingApproval.attempts
          } : null
        } 
      });

    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  listTasks(req: Request, res: Response): void {
    try {
      const { status, limit = '10', offset = '0' } = req.query;
      const tasks = getTasks(this.db, {
        status: status as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });

      const tasksWithStats = tasks.map((task: any) => ({
        ...task,
        stats: getTaskStats(this.db, task.id)
      }));
      
      // Add pending approval count
      const pendingApprovalCount = this.pendingApprovals.size;
      
      res.json({ 
        success: true, 
        tasks: tasksWithStats, 
        count: tasksWithStats.length,
        pendingApprovals: pendingApprovalCount
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  getPendingApprovals(req: Request, res: Response): void {
    try {
      const approvals = Array.from(this.pendingApprovals.values()).map(pa => ({
        taskId: pa.taskId,
        plan: pa.plan,
        validatorFeedback: pa.validatorFeedback,
        userInput: pa.userInput,
        createdAt: pa.createdAt,
        attempts: pa.attempts
      }));
      
      res.json({ success: true, approvals, count: approvals.length });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  getTaskTimeline(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 100;
      const events = getTimelineEvents(this.db, taskId, limit);
      res.json({ success: true, taskId, events });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  getTaskExecutions(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      const executions = getTaskExecutions(this.db, taskId);
      res.json({ success: true, taskId, executions });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  cancelTask(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      const task = getTask(this.db, taskId);

      if (!task) {
        res.status(404).json({ success: false, error: 'Tarea no encontrada' });
        return;
      }

      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        res.status(400).json({ success: false, error: 'Tarea ya finalizada' });
        return;
      }

      // Remove from pending approvals if exists
      this.pendingApprovals.delete(taskId);

      updateTaskStatus(this.db, taskId, 'cancelled');
      this.recordTimeline(taskId, 'task_cancelled', 'Cancelada por usuario');
      socketManager.notifyTaskStatusChange(taskId, 'cancelled');

      res.json({ success: true, message: 'Tarea cancelada' });

    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  pauseTask(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      const task = getTask(this.db, taskId);

      if (!task) {
        res.status(404).json({ success: false, error: 'Tarea no encontrada' });
        return;
      }

      if (['completed', 'failed', 'cancelled', 'paused'].includes(task.status)) {
        res.status(400).json({ success: false, error: `No se puede pausar tarea con estado: ${task.status}` });
        return;
      }

      updateTaskStatus(this.db, taskId, 'paused');
      this.recordTimeline(taskId, 'task_paused', 'Pausada por usuario');
      socketManager.notifyTaskStatusChange(taskId, 'paused');

      res.json({ success: true, message: 'Tarea pausada' });

    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  resumeTask(req: Request, res: Response): void {
    try {
      const taskId = parseInt(req.params.id);
      const task = getTask(this.db, taskId);

      if (!task) {
        res.status(404).json({ success: false, error: 'Tarea no encontrada' });
        return;
      }

      if (task.status !== 'paused') {
        res.status(400).json({ success: false, error: 'Solo se pueden reanudar tareas pausadas' });
        return;
      }

      // Check if there's a pending approval
      const pendingApproval = this.pendingApprovals.get(taskId);
      if (pendingApproval) {
        updateTaskStatus(this.db, taskId, 'awaiting_approval');
        res.json({ success: true, message: 'Tarea reanudada. Esperando aprobación.', status: 'awaiting_approval' });
      } else {
        // Resume from where it left off - need to determine the correct phase
        updateTaskStatus(this.db, taskId, 'orchestrating');
        res.json({ success: true, message: 'Tarea reanudada', status: 'orchestrating' });
      }

      this.recordTimeline(taskId, 'task_resumed', 'Reanudada por usuario');
      socketManager.notifyTaskStatusChange(taskId, task.status);

    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }
}

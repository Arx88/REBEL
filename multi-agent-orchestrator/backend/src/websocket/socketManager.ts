import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { EventEmitter } from 'events';

export interface WebSocketMessage {
  type: string;
  payload: unknown;
}

export interface AgentStatus {
  id: string;
  type: string;
  status: 'idle' | 'busy' | 'error' | 'recovering';
  currentTask?: string;
  currentSubtask?: string;
  health: {
    consecutiveFailures: number;
    circuitBreakerOpen: boolean;
    lastError?: string;
  };
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  taskId: string;
  message: string;
  details?: Record<string, unknown>;
}

export class SocketManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private taskSubscriptions: Map<number, Set<string>> = new Map();
  private globalSubscribers: Set<string> = new Set();

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server });
    console.log('[SocketManager] WebSocket server initialized');

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.clients.set(clientId, ws);

      this.sendToClient(clientId, { 
        type: 'connected', 
        payload: { clientId, serverTime: new Date().toISOString() } 
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch (e) {
          this.sendToClient(clientId, { 
            type: 'error', 
            payload: { message: 'Invalid message format' } 
          });
        }
      });

      ws.on('close', () => this.handleClientDisconnect(clientId));
      ws.on('error', (err) => {
        console.error(`[SocketManager] Client ${clientId} error:`, err.message);
        this.handleClientDisconnect(clientId);
      });
    });
  }

  private handleClientMessage(clientId: string, message: WebSocketMessage): void {
    switch (message.type) {
      case 'subscribe_task':
        this.handleSubscribeTask(clientId, (message.payload as { taskId: number }).taskId);
        break;
      case 'unsubscribe_task':
        this.handleUnsubscribeTask(clientId, (message.payload as { taskId: number }).taskId);
        break;
      case 'subscribe_global':
        this.globalSubscribers.add(clientId);
        this.sendToClient(clientId, { type: 'subscribed_global', payload: {} });
        break;
      case 'unsubscribe_global':
        this.globalSubscribers.delete(clientId);
        this.sendToClient(clientId, { type: 'unsubscribed_global', payload: {} });
        break;
      case 'ping':
        this.sendToClient(clientId, { 
          type: 'pong', 
          payload: { timestamp: new Date().toISOString() } 
        });
        break;
      case 'request_agent_status':
        this.emit('request_agent_status', { clientId });
        break;
      case 'request_tasks':
        this.emit('request_tasks', { clientId });
        break;
      default:
        this.emit('client_message', { clientId, message });
    }
  }

  private handleSubscribeTask(clientId: string, taskId: number): void {
    if (!this.taskSubscriptions.has(taskId)) {
      this.taskSubscriptions.set(taskId, new Set());
    }
    this.taskSubscriptions.get(taskId)!.add(clientId);
    this.sendToClient(clientId, { type: 'subscribed', payload: { taskId } });
    this.emit('request_task_state', { taskId, clientId });
  }

  private handleUnsubscribeTask(clientId: string, taskId: number): void {
    this.taskSubscriptions.get(taskId)?.delete(clientId);
    this.sendToClient(clientId, { type: 'unsubscribed', payload: { taskId } });
  }

  private handleClientDisconnect(clientId: string): void {
    for (const [taskId, subscribers] of this.taskSubscriptions) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) this.taskSubscriptions.delete(taskId);
    }
    this.globalSubscribers.delete(clientId);
    this.clients.delete(clientId);
  }

  sendToClient(clientId: string, message: WebSocketMessage): boolean {
    const ws = this.clients.get(clientId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
      return true;
    }
    return false;
  }

  broadcastToTask(taskId: number, message: WebSocketMessage): void {
    const subscribers = this.taskSubscriptions.get(taskId);
    if (!subscribers) return;

    const msgStr = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
    for (const clientId of subscribers) {
      const ws = this.clients.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) ws.send(msgStr);
    }
  }

  broadcastToGlobal(message: WebSocketMessage): void {
    const msgStr = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
    for (const clientId of this.globalSubscribers) {
      const ws = this.clients.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) ws.send(msgStr);
    }
  }

  broadcastToAll(message: WebSocketMessage): void {
    const msgStr = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msgStr);
    }
  }

  // Agent status updates
  notifyAgentUpdate(agentData: AgentStatus): void {
    this.broadcastToAll({ type: 'agent_update', payload: agentData });
  }

  notifyAgentPoolStatus(agents: AgentStatus[]): void {
    this.broadcastToAll({ type: 'agent_pool_status', payload: { agents } });
  }

  // Timeline events
  notifyTimelineEvent(event: TimelineEvent): void {
    const taskIdNum = parseInt(event.taskId, 10);
    if (!isNaN(taskIdNum)) {
      this.broadcastToTask(taskIdNum, { type: 'timeline_event', payload: event });
    }
    this.broadcastToGlobal({ type: 'timeline_event', payload: event });
  }

  // Task lifecycle notifications
  notifyTaskCreated(task: unknown): void {
    this.broadcastToAll({ type: 'task_created', payload: task });
  }

  notifyTaskStatusChange(taskId: number, status: string, details?: unknown): void {
    const message = { type: 'task_status_change', payload: { taskId, status, details } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyPlanGenerated(taskId: number, plan: unknown): void {
    const message = { type: 'plan_generated', payload: { taskId, plan } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyApprovalRequired(taskId: number, plan: unknown, validation?: unknown): void {
    const message = { 
      type: 'approval_required', 
      payload: { taskId, plan, validation } 
    };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyPlanApproved(taskId: number): void {
    const message = { type: 'plan_approved', payload: { taskId } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyPlanRejected(taskId: number, reason?: string): void {
    const message = { type: 'plan_rejected', payload: { taskId, reason } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyRevisionRequested(taskId: number, feedback: string): void {
    const message = { type: 'revision_requested', payload: { taskId, feedback } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifySubtaskProgress(taskId: number, subtaskId: string, status: string, result?: unknown): void {
    const message = { 
      type: 'subtask_progress', 
      payload: { taskId, subtaskId, status, result } 
    };
    this.broadcastToTask(taskId, message);
  }

  notifyTaskProgress(taskId: number, progress: number, currentPhase?: string, currentSubtask?: string): void {
    const message = { 
      type: 'task_progress', 
      payload: { taskId, progress, currentPhase, currentSubtask } 
    };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyTaskComplete(taskId: number, result: unknown): void {
    const message = { type: 'task_complete', payload: { taskId, result } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyTaskFailed(taskId: number, error: string, details?: unknown): void {
    const message = { type: 'task_failed', payload: { taskId, error, details } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyTaskPaused(taskId: number): void {
    const message = { type: 'task_paused', payload: { taskId } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyTaskResumed(taskId: number): void {
    const message = { type: 'task_resumed', payload: { taskId } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  notifyTaskCancelled(taskId: number): void {
    const message = { type: 'task_cancelled', payload: { taskId } };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  // Error notifications
  notifyError(taskId: number | null, error: string, details?: unknown): void {
    const message = { type: 'error', payload: { error, details, taskId } };
    if (taskId) {
      this.broadcastToTask(taskId, message);
    }
    this.broadcastToGlobal(message);
  }

  // ============================================
  // ENHANCED DETAILED NOTIFICATIONS
  // ============================================

  /**
   * Notify about model fallback due to rate limit
   */
  notifyModelFallback(taskId: number | null, data: {
    agentId: string;
    fromModel: string;
    toModel: string;
    reason: 'rate_limit' | 'error' | 'timeout' | 'circuit_breaker';
    fallbackAttempt: number;
    maxAttempts: number;
  }): void {
    const message = { 
      type: 'model_fallback', 
      payload: {
        ...data,
        taskId,
        humanReadable: `Agente ${data.agentId} cambio de ${data.fromModel} a ${data.toModel} (${data.reason})`,
        severity: data.fallbackAttempt >= data.maxAttempts - 1 ? 'warning' : 'info'
      }
    };
    if (taskId) this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  /**
   * Notify about model being restored after cooldown
   */
  notifyModelRestored(taskId: number | null, data: {
    agentId: string;
    model: string;
  }): void {
    const message = {
      type: 'model_restored',
      payload: {
        ...data,
        taskId,
        humanReadable: `Agente ${data.agentId} restaurado a modelo ${data.model}`
      }
    };
    if (taskId) this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  /**
   * Detailed phase progress notification
   */
  notifyPhaseProgress(taskId: number, data: {
    phaseIndex: number;
    phaseName: string;
    totalPhases: number;
    status: 'starting' | 'in_progress' | 'validating' | 'completed' | 'failed';
    completedSubtasks: number;
    totalSubtasks: number;
    currentSubtask?: {
      id: string;
      description: string;
      assignedAgent: string;
      model: string;
    };
    estimatedTimeRemaining?: number;
  }): void {
    const percentComplete = Math.round((data.completedSubtasks / data.totalSubtasks) * 100);
    const overallProgress = Math.round(((data.phaseIndex + (data.completedSubtasks / data.totalSubtasks)) / data.totalPhases) * 100);
    
    const message = {
      type: 'phase_progress',
      payload: {
        ...data,
        taskId,
        percentComplete,
        overallProgress,
        humanReadable: this.buildPhaseProgressMessage(data)
      }
    };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  private buildPhaseProgressMessage(data: {
    phaseName: string;
    phaseIndex: number;
    totalPhases: number;
    completedSubtasks: number;
    totalSubtasks: number;
    status: string;
    currentSubtask?: { description: string; assignedAgent: string };
  }): string {
    const phaseNum = data.phaseIndex + 1;
    const base = `Fase ${phaseNum}/${data.totalPhases}: ${data.phaseName}`;
    
    switch (data.status) {
      case 'starting':
        return `${base} - Iniciando...`;
      case 'in_progress':
        const subtaskInfo = data.currentSubtask 
          ? ` | Subtarea actual: ${data.currentSubtask.description.substring(0, 50)}...`
          : '';
        return `${base} - Progreso: ${data.completedSubtasks}/${data.totalSubtasks}${subtaskInfo}`;
      case 'validating':
        return `${base} - Validando resultados...`;
      case 'completed':
        return `${base} - Completada exitosamente`;
      case 'failed':
        return `${base} - Error en la fase`;
      default:
        return base;
    }
  }

  /**
   * Detailed subtask execution notification
   */
  notifySubtaskExecution(taskId: number, data: {
    subtaskId: string;
    description: string;
    phase: string;
    assignedAgent: string;
    model: string;
    status: 'queued' | 'starting' | 'executing' | 'completed' | 'failed' | 'retrying';
    attempt?: number;
    maxAttempts?: number;
    executionTimeMs?: number;
    result?: {
      success: boolean;
      summary?: string;
      outputPreview?: string;
    };
    error?: string;
  }): void {
    const message = {
      type: 'subtask_execution',
      payload: {
        ...data,
        taskId,
        humanReadable: this.buildSubtaskMessage(data)
      }
    };
    this.broadcastToTask(taskId, message);
  }

  private buildSubtaskMessage(data: {
    subtaskId: string;
    description: string;
    assignedAgent: string;
    model: string;
    status: string;
    attempt?: number;
    maxAttempts?: number;
    executionTimeMs?: number;
  }): string {
    const shortDesc = data.description.length > 60 
      ? data.description.substring(0, 57) + '...' 
      : data.description;
    
    switch (data.status) {
      case 'queued':
        return `[${data.subtaskId}] En cola: ${shortDesc}`;
      case 'starting':
        return `[${data.subtaskId}] Iniciando con ${data.assignedAgent} (${data.model}): ${shortDesc}`;
      case 'executing':
        return `[${data.subtaskId}] Ejecutando: ${shortDesc}`;
      case 'completed':
        const time = data.executionTimeMs ? ` (${(data.executionTimeMs / 1000).toFixed(1)}s)` : '';
        return `[${data.subtaskId}] Completada${time}: ${shortDesc}`;
      case 'failed':
        return `[${data.subtaskId}] Error: ${shortDesc}`;
      case 'retrying':
        return `[${data.subtaskId}] Reintentando (${data.attempt}/${data.maxAttempts}): ${shortDesc}`;
      default:
        return `[${data.subtaskId}] ${data.status}: ${shortDesc}`;
    }
  }

  /**
   * Agent thinking/reasoning notification (for transparency)
   */
  notifyAgentThinking(taskId: number, data: {
    agentId: string;
    agentType: string;
    phase: string;
    thinking: string;
    context?: string;
  }): void {
    const message = {
      type: 'agent_thinking',
      payload: {
        ...data,
        taskId,
        humanReadable: `[${data.agentType}] Analizando: ${data.thinking.substring(0, 100)}...`
      }
    };
    this.broadcastToTask(taskId, message);
  }

  /**
   * Plan improvement iteration notification
   */
  notifyPlanIteration(taskId: number, data: {
    iteration: number;
    maxIterations: number;
    improverAgent: string;
    improvements: Array<{
      type: 'added' | 'modified' | 'removed';
      target: string;
      description: string;
    }>;
    overallScore: number;
    previousScore?: number;
  }): void {
    const scoreChange = data.previousScore 
      ? (data.overallScore - data.previousScore > 0 ? '+' : '') + (data.overallScore - data.previousScore).toFixed(1)
      : null;
    
    const message = {
      type: 'plan_iteration',
      payload: {
        ...data,
        taskId,
        scoreChange,
        humanReadable: `Iteracion ${data.iteration}/${data.maxIterations}: ${data.improvements.length} mejoras aplicadas. Score: ${data.overallScore}${scoreChange ? ` (${scoreChange})` : ''}`
      }
    };
    this.broadcastToTask(taskId, message);
    this.broadcastToGlobal(message);
  }

  /**
   * Validation checkpoint notification
   */
  notifyValidationCheckpoint(taskId: number, data: {
    phase: string;
    checkpoint: string;
    passed: boolean;
    details?: string;
    blocksProgress: boolean;
  }): void {
    const message = {
      type: 'validation_checkpoint',
      payload: {
        ...data,
        taskId,
        humanReadable: `Checkpoint "${data.checkpoint}": ${data.passed ? 'PASADO' : 'FALLIDO'}${data.details ? ` - ${data.details}` : ''}`
      }
    };
    this.broadcastToTask(taskId, message);
  }

  /**
   * Memory/context update notification
   */
  notifyContextUpdate(taskId: number, data: {
    action: 'added' | 'updated' | 'removed';
    key: string;
    summary: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    size?: number;
  }): void {
    const message = {
      type: 'context_update',
      payload: {
        ...data,
        taskId,
        humanReadable: `Contexto ${data.action}: ${data.key} (${data.priority})`
      }
    };
    this.broadcastToTask(taskId, message);
  }

  /**
   * Comprehensive status snapshot
   */
  notifyStatusSnapshot(taskId: number, data: {
    taskStatus: string;
    currentPhase: {
      index: number;
      name: string;
      progress: number;
    };
    agents: Array<{
      id: string;
      status: string;
      currentModel: string;
      usingFallback: boolean;
    }>;
    memory: {
      entriesCount: number;
      totalSize: number;
    };
    timeline: {
      eventsCount: number;
      lastEvent?: string;
    };
    timing: {
      startedAt: string;
      elapsedMs: number;
      estimatedRemainingMs?: number;
    };
  }): void {
    const message = {
      type: 'status_snapshot',
      payload: {
        ...data,
        taskId
      }
    };
    this.broadcastToTask(taskId, message);
  }

  /**
   * Batch notification for multiple events
   */
  notifyBatch(taskId: number, events: Array<{ type: string; payload: unknown }>): void {
    const message = {
      type: 'batch_update',
      payload: {
        taskId,
        events,
        count: events.length
      }
    };
    this.broadcastToTask(taskId, message);
  }

  // Connection info
  getConnectionStats(): { totalClients: number; globalSubscribers: number; taskSubscriptions: number } {
    return {
      totalClients: this.clients.size,
      globalSubscribers: this.globalSubscribers.size,
      taskSubscriptions: this.taskSubscriptions.size,
    };
  }

  close(): void {
    for (const ws of this.clients.values()) ws.close();
    this.clients.clear();
    this.taskSubscriptions.clear();
    this.globalSubscribers.clear();
    this.wss?.close();
  }
}

export const socketManager = new SocketManager();

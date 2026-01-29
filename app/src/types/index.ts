// Re-export shared types
export type TaskStatus = 
  | 'pending'
  | 'planning'
  | 'awaiting_approval'
  | 'validating'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface SubTask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  assignedAgent?: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  dependencies?: string[];
  estimated_complexity?: 'low' | 'medium' | 'high';
}

export interface Phase {
  name: string;
  description: string;
  subtasks: SubTask[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface Plan {
  objective: string;
  phases: Phase[];
  estimated_total_time?: string;
  risks?: string[];
  assumptions?: string[];
}

export interface ValidationResult {
  approved: boolean;
  score: number;
  issues: Array<{
    severity: 'critical' | 'warning' | 'suggestion';
    description: string;
    affected_subtask?: string;
  }>;
  suggestions: string[];
}

export interface Task {
  id: string;
  userInput: string;
  status: TaskStatus;
  priority: TaskPriority;
  plan?: Plan;
  validation?: ValidationResult;
  userFeedback?: string;
  revisionCount: number;
  maxRevisions: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AgentInfo {
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
  type: 'task_created' | 'plan_generated' | 'approval_required' | 'approved' | 'rejected' | 'revision_requested' | 'execution_started' | 'subtask_completed' | 'task_completed' | 'error' | 'agent_assigned' | 'agent_released';
  taskId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WebSocketMessage {
  type: string;
  payload: unknown;
}

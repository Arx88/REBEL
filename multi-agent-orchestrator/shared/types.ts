// Tipos compartidos entre frontend y backend

export type AgentModel = 'gemini' | 'qwen';
export type AgentType = 'master_planner' | 'plan_validator' | 'plan_refiner' | 'orchestrator' | 'worker' | 'validator' | 'synthesizer' | 'critic';
export type ModelTier = 'premium' | 'standard' | 'fallback' | 'emergency';

// Extended task status with approval states
export type TaskStatus = 
  | 'planning' 
  | 'refining_plan'          // Plan refinement phase
  | 'awaiting_approval'      // Waiting for user to approve plan
  | 'validating_plan' 
  | 'orchestrating' 
  | 'executing' 
  | 'validating' 
  | 'synthesizing' 
  | 'completed' 
  | 'failed'
  | 'cancelled'
  | 'paused';                 // Task paused by user

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
export type ValidationResult = 'passed' | 'failed' | 'needs_revision';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modification_requested';

export interface SubTask {
  id: string;
  description: string;
  assigned_agent_type: 'researcher' | 'implementer' | 'analyzer';
  required_context: string[];
  files_to_read: string[];
  deliverable: string;
  validation_method: string;
  estimated_complexity: number;
  dependencies: string[];
}

export interface Phase {
  name: string;
  why_necessary: string;
  subtasks: SubTask[];
  validation_checkpoints: string[];
  failure_points: string[];
}

export interface Plan {
  objective: string;
  context_requirements: {
    files_to_analyze: string[];
    documentation_to_read: string[];
    existing_systems_to_understand: string[];
    validation_criteria: string[];
  };
  phases: Phase[];
  success_criteria: string[];
  failure_prevention: string[];
}

export interface Task {
  id: number;
  user_input: string;
  status: TaskStatus;
  approval_status?: ApprovalStatus;
  created_at: string;
  completed_at?: string;
  final_result?: string;
  user_feedback?: string;
}

export interface AgentExecution {
  id: number;
  task_id: number;
  agent_type: AgentType;
  agent_model: AgentModel;
  agent_index?: number;
  phase: string;
  subtask_description?: string;
  prompt_sent: string;
  response_received?: string;
  status: ExecutionStatus;
  started_at?: string;
  completed_at?: string;
  execution_time_ms?: number;
  retry_count?: number;
}

export interface AgentState {
  id: string;
  model: AgentModel;
  type: AgentType;
  index?: number;
  status: 'idle' | 'working' | 'completed' | 'error' | 'circuit_breaker_open';
  currentTask?: string;
  progress?: number;
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
}

export interface TimelineEvent {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'approval_needed';
  data?: any;
}

// Human-in-the-Loop Types
export interface PlanApprovalRequest {
  taskId: number;
  plan: Plan;
  validatorFeedback?: {
    approved: boolean;
    confidence: number;
    issues: string[];
    suggestions: string[];
  };
  createdAt: string;
}

export interface PlanApprovalResponse {
  taskId: number;
  action: 'approve' | 'reject' | 'modify';
  feedback?: string;
  modifications?: Partial<Plan>;
}

export interface UserFeedbackRequest {
  taskId: number;
  phase: string;
  question: string;
  options?: string[];
  requiresTextInput?: boolean;
}

export interface UserFeedbackResponse {
  taskId: number;
  feedbackId: string;
  response: string;
  selectedOption?: string;
}

// WebSocket Message Types
export type WebSocketMessageType = 
  | 'agent_update' 
  | 'timeline_update' 
  | 'task_complete' 
  | 'plan_generated'
  | 'plan_needs_approval'      // NEW: Request user approval
  | 'approval_received'         // NEW: User approved/rejected
  | 'execution_progress' 
  | 'feedback_request'          // NEW: Ask user for input
  | 'feedback_received'         // NEW: User provided feedback
  | 'error'
  | 'task_status_change'
  | 'agent_pool_status'
  | 'circuit_breaker_update';   // NEW: Circuit breaker state change

export interface WebSocketMessage {
  type: WebSocketMessageType;
  payload: any;
  timestamp?: string;
}

export interface CreateTaskRequest {
  userInput: string;
  context?: string;
  autoApprove?: boolean;  // NEW: Skip approval step
}

export interface CreateTaskResponse {
  taskId: number;
  message: string;
  status: TaskStatus;
}

// Retry and Error Handling
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export interface ExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  agentId?: string;
  phase?: string;
  timestamp: string;
}

// Memory Types
export interface MemoryEntry {
  key: string;
  value: any;
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessed: string;
  embedding?: number[];  // For semantic search
  summary?: string;
}

export interface MemoryQueryOptions {
  includeKeys?: string[];
  excludeKeys?: string[];
  maxLength?: number;
  format?: 'json' | 'markdown' | 'text' | 'compressed';
  priorityThreshold?: 'critical' | 'high' | 'medium' | 'low';
  semanticQuery?: string;  // For semantic search
  maxResults?: number;
  sortBy?: 'priority' | 'recency' | 'accessCount' | 'size';
}

// ============================================
// CMN (Contexto Minimo Necesario) TYPES
// ============================================

export interface CMNOptions {
  query: string;
  maxTokens: number;
  includeStructure?: boolean;
  priorityBoost?: boolean;
}

export interface SemanticSearchResult {
  key: string;
  value: any;
  score: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  summary?: string;
}

// ============================================
// DELEGATION CONTRACT TYPES
// ============================================

export interface DelegationContract {
  subtaskId: string;
  objective: string;
  contextCMN: string;
  deliverable: string;
  verificationCriteria: string;
  maxTokens: number;
  assignedModel: 'gemini' | 'qwen';
  dependencies: string[];
  files_to_read?: string[];
}

// ============================================
// CRITIC AGENT TYPES
// ============================================

export type CriticVerdict = 'PASS' | 'FAIL' | 'NEEDS_REVISION';

export interface CriticIssue {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  category: 'logic' | 'completeness' | 'correctness' | 'style' | 'security' | 'performance';
  description: string;
  location?: string;
  impact: string;
}

export interface SuggestedFix {
  issue: string;
  fix: string;
  confidence: number;
  codeSnippet?: string;
}

export interface CriticResult {
  verdict: CriticVerdict;
  confidence: number;
  reasoning: string;
  issues: CriticIssue[];
  suggestedFixes: SuggestedFix[];
  passedChecks: string[];
  failedChecks: string[];
  executionTime: number;
}

export interface CriticFeedback {
  subtaskId: string;
  verdict: CriticVerdict;
  feedbackForAgent: string;
  requiredChanges: string[];
  iteration: number;
}

// ============================================
// TRIPLE CHECK VERIFICATION TYPES
// ============================================

export interface VerificationCheckResult {
  passed: boolean;
  errors: string[];
  timestamp: number;
}

export interface TripleCheckResult {
  structuralCheck?: VerificationCheckResult;  // Level 1
  logicalCheck?: CriticResult;                 // Level 2
  integrationCheck?: VerificationCheckResult;  // Level 3
  overallPassed: boolean;
}

// ============================================
// ENHANCED PLAN VISUALIZATION TYPES
// ============================================

/**
 * Rich plan representation for UI visualization
 */
export interface EnhancedPlan extends Plan {
  metadata: PlanMetadata;
  visualization: PlanVisualization;
  refinementHistory?: PlanRefinementHistory;
}

export interface PlanMetadata {
  version: number;
  createdAt: string;
  lastModifiedAt: string;
  createdBy: AgentType;
  refinedBy?: AgentType[];
  score: PlanScore;
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  estimatedDuration: {
    min: number; // minutes
    max: number;
    average: number;
  };
  tags: string[];
}

export interface PlanScore {
  overall: number;
  completeness: number;
  feasibility: number;
  clarity: number;
  riskManagement: number;
  efficiency: number;
  details: string[];
}

export interface PlanVisualization {
  // Dependency graph for phases/subtasks
  dependencyGraph: DependencyNode[];
  // Timeline view data
  timeline: TimelinePhase[];
  // Critical path through the plan
  criticalPath: string[];
  // Parallel execution groups
  parallelGroups: ParallelGroup[];
  // Risk heat map
  riskMap: RiskMapEntry[];
}

export interface DependencyNode {
  id: string;
  type: 'phase' | 'subtask';
  label: string;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  depth: number; // Depth in dependency tree
  position?: { x: number; y: number }; // For graph rendering
}

export interface TimelinePhase {
  id: string;
  name: string;
  startOffset: number; // Minutes from start
  duration: number; // Minutes
  subtasks: TimelineSubtask[];
  isParallel: boolean;
  dependencies: string[];
}

export interface TimelineSubtask {
  id: string;
  description: string;
  startOffset: number;
  duration: number;
  assignedAgent: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
}

export interface ParallelGroup {
  groupId: string;
  phase: string;
  subtasks: string[];
  canRunInParallel: boolean;
  reason?: string;
}

export interface RiskMapEntry {
  subtaskId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  mitigations: string[];
}

export interface PlanRefinementHistory {
  iterations: PlanIteration[];
  totalImprovements: number;
  scoreProgress: Array<{ iteration: number; score: number }>;
}

export interface PlanIteration {
  iteration: number;
  timestamp: string;
  agent: string;
  focusArea: string;
  improvements: PlanImprovement[];
  scoreBefore: number;
  scoreAfter: number;
}

export interface PlanImprovement {
  type: 'added' | 'modified' | 'removed' | 'reordered';
  target: 'phase' | 'subtask' | 'dependency' | 'validation' | 'context';
  targetId?: string;
  description: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

// ============================================
// MODEL FALLBACK TYPES
// ============================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: AgentModel;
  tier: ModelTier;
  capabilities: string[];
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  isAvailable: boolean;
  cooldownUntil?: number;
}

export interface ModelFallbackEvent {
  timestamp: string;
  taskId?: number;
  agentId: string;
  fromModel: string;
  toModel: string;
  reason: 'rate_limit' | 'error' | 'timeout' | 'circuit_breaker';
  fallbackAttempt: number;
}

export interface ModelStatus {
  currentModel: ModelInfo;
  originalModel: ModelInfo;
  usingFallback: boolean;
  fallbackHistory: ModelFallbackEvent[];
}

// ============================================
// DETAILED PROGRESS TYPES
// ============================================

export interface DetailedTaskProgress {
  taskId: number;
  status: TaskStatus;
  currentPhase: {
    index: number;
    name: string;
    progress: number; // 0-100
    startedAt?: string;
    estimatedCompletion?: string;
  };
  subtasks: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
  };
  agents: AgentStatus[];
  memory: {
    entries: number;
    size: number;
    criticalItems: number;
  };
  timing: {
    startedAt: string;
    elapsedMs: number;
    estimatedRemainingMs?: number;
    phases: Array<{
      name: string;
      durationMs?: number;
      status: 'pending' | 'running' | 'completed' | 'failed';
    }>;
  };
  modelUsage: {
    primaryModel: string;
    fallbacksUsed: number;
    rateLimitsHit: number;
  };
}

export interface AgentStatus {
  id: string;
  type: AgentType;
  model: AgentModel;
  currentModelId: string;
  status: 'idle' | 'working' | 'rate_limited' | 'error' | 'recovering';
  currentTask?: string;
  usingFallback: boolean;
  fallbackLevel: number;
  stats: {
    requestsCompleted: number;
    requestsFailed: number;
    averageResponseTime: number;
  };
}

// ============================================
// APPROVAL FLOW TYPES
// ============================================

export interface PlanApprovalData {
  taskId: number;
  plan: EnhancedPlan;
  validationResult: {
    approved: boolean;
    confidence: number;
    issues: ValidationIssue[];
    suggestions: string[];
  };
  refinementSummary?: {
    iterations: number;
    totalImprovements: number;
    scoreImprovement: number;
  };
  suggestedActions: ('approve' | 'reject' | 'modify')[];
  expiresAt?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  location?: {
    phase?: string;
    subtask?: string;
  };
  suggestion?: string;
}

// ============================================
// REAL-TIME UPDATE MESSAGE TYPES
// ============================================

export type DetailedMessageType = 
  | 'model_fallback'
  | 'model_restored'
  | 'phase_progress'
  | 'subtask_execution'
  | 'agent_thinking'
  | 'plan_iteration'
  | 'validation_checkpoint'
  | 'context_update'
  | 'status_snapshot'
  | 'batch_update'
  | 'plan_refined';

export interface DetailedWebSocketMessage {
  type: DetailedMessageType | WebSocketMessageType;
  payload: unknown;
  timestamp: string;
  taskId?: number;
  humanReadable?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

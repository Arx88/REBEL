import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  Bot, 
  ListTodo, 
  RefreshCw,
  WifiOff,
  Zap,
  ChevronRight,
  Clock,
  CheckCircle2,
  Loader2,
  TrendingUp,
  Cpu,
  BarChart3,
  Sparkles
} from 'lucide-react';

import { AgentGrid } from './AgentGrid';
import { Timeline } from './Timeline';
import { PlanApproval } from './PlanApproval';
import { TaskCard } from './TaskCard';
import { CreateTaskDialog } from './CreateTaskDialog';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

interface Task {
  id: number;
  user_input: string;
  status: string;
  created_at: string;
  completed_at?: string;
  stats?: { total: number; completed: number; failed: number };
}

interface Agent {
  id: string;
  model: 'gemini' | 'qwen';
  status: 'ready' | 'busy' | 'error' | 'circuit_breaker_open' | 'initializing';
  inUse: boolean;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  totalExecutions: number;
  failedExecutions: number;
  successRate: number;
  currentModel?: string;
  usingFallback?: boolean;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'approval_needed' | 'phase_start';
  message: string;
  details?: any;
  taskId?: number;
}

interface PendingApproval {
  taskId: number;
  plan: any;
  validatorFeedback: any;
}

export function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [activityFeed, setActivityFeed] = useState<TimelineEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, ready: 0, busy: 0 });
  const [taskFocus, setTaskFocus] = useState<{
    status?: string;
    currentPhase?: string;
    currentSubtask?: string;
    lastEvent?: string;
    lastEventAt?: string;
    progress?: number;
    completedSubtasks?: number;
    totalSubtasks?: number;
    phaseStatus?: string;
  } | null>(null);

  const { isConnected, subscribe, subscribeGlobal } = useWebSocket({
    url: WS_URL,
    onConnect: () => {
      if (selectedTaskId) subscribe(selectedTaskId);
    },
    onMessage: (message) => handleWebSocketMessage(message),
  });

  const mapTimelineType = useCallback((eventType: string): TimelineEvent['type'] => {
    const normalized = eventType.toLowerCase();
    if (normalized.includes('phase_start')) return 'phase_start';
    if (normalized.includes('approval')) return 'approval_needed';
    if (normalized.includes('error') || normalized.includes('failed')) return 'error';
    if (normalized.includes('warning') || normalized.includes('cancel')) return 'warning';
    if (
      normalized.includes('completed') ||
      normalized.includes('approved') ||
      normalized.includes('refined') ||
      normalized.includes('generated') ||
      normalized.includes('validated') ||
      normalized.includes('restored')
    ) {
      return 'success';
    }
    if (normalized.includes('fallback')) return 'warning';
    return 'info';
  }, []);

  const appendTimelineEvent = useCallback((event: TimelineEvent) => {
    setTimeline(prev => [...prev, event].slice(-200));
  }, []);

  const appendActivityEvent = useCallback((event: TimelineEvent) => {
    setActivityFeed(prev => [...prev, event].slice(-200));
  }, []);

  const buildTimelineEvent = useCallback((data: {
    type: string;
    message?: string;
    details?: any;
    timestamp?: string;
    taskId?: number;
    humanReadable?: string;
  }): TimelineEvent => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: data.timestamp || new Date().toISOString(),
    type: mapTimelineType(data.type),
    message: data.humanReadable || data.message || data.type,
    details: data.details,
    taskId: data.taskId
  }), [mapTimelineType]);

  const handleWebSocketMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'agent_pool_status':
        setAgents(message.payload.agents || []);
        setStats({
          total: message.payload.total || 0,
          ready: message.payload.ready || 0,
          busy: message.payload.busy || 0,
        });
        break;

      case 'task_status_change':
        setTasks(prev => prev.map(t => 
          t.id === message.payload.taskId 
            ? { ...t, status: message.payload.status }
            : t
        ));
        if (message.payload.taskId === selectedTaskId) {
          setTaskFocus(prev => ({
            ...(prev || {}),
            status: message.payload.status,
            lastEvent: `Estado actualizado: ${message.payload.status}`,
            lastEventAt: message.timestamp || new Date().toISOString()
          }));
        }
        appendActivityEvent(buildTimelineEvent({
          type: 'task_status_change',
          message: `Tarea #${message.payload.taskId} → ${message.payload.status}`,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        }));
        break;

      case 'timeline_event':
      case 'timeline_update': {
        const event = buildTimelineEvent({
          type: message.payload.type || 'info',
          message: message.payload.message,
          details: message.payload.details,
          timestamp: message.timestamp,
          taskId: Number(message.payload.taskId)
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
          setTaskFocus(prev => ({
            ...(prev || {}),
            lastEvent: event.message,
            lastEventAt: event.timestamp
          }));
        }
        appendActivityEvent(event);
        break;
      }

      case 'plan_needs_approval':
        setPendingApprovals(prev => [
          ...prev.filter(p => p.taskId !== message.payload.taskId),
          message.payload
        ]);
        appendActivityEvent(buildTimelineEvent({
          type: 'approval_needed',
          message: message.payload.message || `Plan requiere aprobación para tarea #${message.payload.taskId}`,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        }));
        break;

      case 'approval_received':
        setPendingApprovals(prev => 
          prev.filter(p => p.taskId !== message.payload.taskId)
        );
        appendActivityEvent(buildTimelineEvent({
          type: 'approval_received',
          message: `Aprobación recibida para tarea #${message.payload.taskId}`,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        }));
        break;

      case 'task_state':
        setTasks(prev => {
          const exists = prev.find(task => task.id === message.payload.id);
          if (exists) {
            return prev.map(task => task.id === message.payload.id ? message.payload : task);
          }
          return [message.payload, ...prev];
        });
        break;

      case 'phase_progress': {
        const event = buildTimelineEvent({
          type: message.type,
          message: message.payload.humanReadable,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
          setTaskFocus(prev => ({
            ...(prev || {}),
            currentPhase: message.payload.phaseName,
            progress: message.payload.overallProgress,
            completedSubtasks: message.payload.completedSubtasks,
            totalSubtasks: message.payload.totalSubtasks,
            phaseStatus: message.payload.status,
            lastEvent: event.message,
            lastEventAt: event.timestamp
          }));
        }
        appendActivityEvent(event);
        break;
      }

      case 'subtask_execution': {
        const event = buildTimelineEvent({
          type: message.payload.status || message.type,
          message: message.payload.humanReadable,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
          setTaskFocus(prev => ({
            ...(prev || {}),
            currentSubtask: message.payload.description,
            lastEvent: event.message,
            lastEventAt: event.timestamp
          }));
        }
        appendActivityEvent(event);
        break;
      }

      case 'model_fallback':
      case 'model_restored': {
        const event = buildTimelineEvent({
          type: message.type,
          message: message.payload.humanReadable || message.payload.message,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
        }
        appendActivityEvent(event);
        break;
      }

      case 'task_failed':
      case 'task_paused':
      case 'task_resumed':
      case 'task_cancelled': {
        const event = buildTimelineEvent({
          type: message.type,
          message: message.payload.error || message.payload.message || message.type,
          details: message.payload,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
        }
        appendActivityEvent(event);
        fetchTasks();
        break;
      }

      case 'error': {
        const event = buildTimelineEvent({
          type: message.type,
          message: message.payload.error,
          details: message.payload.details,
          timestamp: message.timestamp,
          taskId: message.payload.taskId
        });
        if (message.payload.taskId === selectedTaskId) {
          appendTimelineEvent(event);
        }
        appendActivityEvent(event);
        break;
      }

      case 'task_complete':
        if (message.payload?.taskId) {
          const event = buildTimelineEvent({
            type: 'task_completed',
            message: `Tarea #${message.payload.taskId} completada`,
            details: message.payload,
            timestamp: message.timestamp,
            taskId: message.payload.taskId
          });
          if (message.payload.taskId === selectedTaskId) {
            appendTimelineEvent(event);
          }
          appendActivityEvent(event);
        }
        fetchTasks();
        break;
    }
  }, [
    selectedTaskId,
    appendTimelineEvent,
    appendActivityEvent,
    buildTimelineEvent,
    fetchTasks
  ]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      const data = await res.json();
      if (data.success) {
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error('Failed to fetch tasks:', e);
    }
  }, []);

  const fetchAgentStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/agents/status`);
      const data = await res.json();
      if (data.success) {
        setAgents(data.agents || []);
        setStats(data.stats || { total: 0, ready: 0, busy: 0 });
      }
    } catch (e) {
      console.error('Failed to fetch agent status:', e);
    }
  }, []);

  const fetchPendingApprovals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/pending/approvals`);
      const data = await res.json();
      if (data.success) {
        setPendingApprovals(data.approvals || []);
      }
    } catch (e) {
      console.error('Failed to fetch pending approvals:', e);
    }
  }, []);

  const fetchTimeline = useCallback(async (taskId: number) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/timeline`);
      const data = await res.json();
      if (data.success) {
        setTimeline(data.events?.map((e: any) => (
          buildTimelineEvent({
            type: e.event_type,
            message: e.message,
            details: e.details ? JSON.parse(e.details) : null,
            timestamp: e.created_at,
            taskId
          })
        )) || []);
      }
    } catch (e) {
      console.error('Failed to fetch timeline:', e);
    }
  }, [buildTimelineEvent]);

  const handleCreateTask = async (data: { userInput: string; context?: string; autoApprove: boolean }) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) {
        fetchTasks();
        setSelectedTaskId(result.taskId);
        subscribe(result.taskId);
      }
    } catch (e) {
      console.error('Failed to create task:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (taskId: number, action: 'approve' | 'reject' | 'modify', feedback?: string) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback }),
      });
      const result = await res.json();
      if (result.success) {
        fetchTasks();
        fetchPendingApprovals();
      }
    } catch (e) {
      console.error('Failed to handle approval:', e);
    }
  };

  const handleCancelTask = async (taskId: number) => {
    try {
      await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: 'POST' });
      fetchTasks();
    } catch (e) {
      console.error('Failed to cancel task:', e);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchAgentStatus();
    fetchPendingApprovals();
  }, [fetchTasks, fetchAgentStatus, fetchPendingApprovals]);

  useEffect(() => {
    if (isConnected) {
      subscribeGlobal();
    }
  }, [isConnected, subscribeGlobal]);

  useEffect(() => {
    if (selectedTaskId) {
      subscribe(selectedTaskId);
      fetchTimeline(selectedTaskId);
    }
  }, [selectedTaskId, subscribe, fetchTimeline]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskFocus(null);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    const task = tasks.find(t => t.id === selectedTaskId);
    if (task) {
      setTaskFocus(prev => ({
        ...(prev || {}),
        status: task.status
      }));
    }
  }, [tasks, selectedTaskId]);

  const activeTasks = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status));
  const completedTasks = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status));
  const successRate = stats.total > 0 ? ((stats.ready / stats.total) * 100).toFixed(0) : '0';
  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) : null;
  const selectedTaskProgress = selectedTask?.stats?.total
    ? Math.round((selectedTask.stats.completed / selectedTask.stats.total) * 100)
    : 0;
  const statusBadgeStyles: Record<string, string> = {
    completed: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    failed: 'border-red-500/40 text-red-400 bg-red-500/10',
    cancelled: 'border-slate-500/40 text-slate-400 bg-slate-500/10',
    awaiting_approval: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    planning: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
    refining_plan: 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10',
    validating_plan: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    orchestrating: 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10',
    synthesizing: 'border-primary/40 text-primary bg-primary/10',
  };

  return (
    <div className="min-h-screen bg-background grid-pattern">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary via-cyan-400 to-emerald-500 flex items-center justify-center glow-sm">
                  <Zap className="w-5 h-5 text-background" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
              </div>
              <div>
                <h1 className="font-bold text-lg tracking-tight text-gradient">REBEL</h1>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">AI Orchestrator</p>
              </div>
            </div>
            
            <div className="h-8 w-px bg-border/50" />
            
            <Badge 
              variant="outline" 
              className={cn(
                "gap-2 py-1.5 px-3 font-medium transition-all duration-300",
                isConnected 
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" 
                  : "border-destructive/50 bg-destructive/10 text-destructive"
              )}
            >
              {isConnected ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  Live
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  Offline
                </>
              )}
            </Badge>
          </div>
          
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => { fetchTasks(); fetchAgentStatus(); }}
              className="hover:bg-primary/10 hover:text-primary"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <CreateTaskDialog onSubmit={handleCreateTask} loading={loading} />
          </div>
        </div>
      </header>

      <main className="container py-8 px-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Total Agents"
            value={stats.total}
            icon={Bot}
            trend={`${successRate}% available`}
            color="primary"
          />
          <StatCard
            title="Ready"
            value={stats.ready}
            icon={CheckCircle2}
            trend="Available now"
            color="success"
          />
          <StatCard
            title="Busy"
            value={stats.busy}
            icon={Loader2}
            trend="Processing"
            color="warning"
            iconClassName="animate-spin"
          />
          <StatCard
            title="Active Tasks"
            value={activeTasks.length}
            icon={Activity}
            trend={`${completedTasks.length} completed`}
            color="primary"
          />
        </div>

        {/* Pending Approvals Alert */}
        {pendingApprovals.length > 0 && (
          <div className="mb-8 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold text-amber-500">
                  {pendingApprovals.length} Plan{pendingApprovals.length > 1 ? 's' : ''} Awaiting Approval
                </p>
                <p className="text-sm text-muted-foreground">Review and approve to continue execution</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
              onClick={() => setSelectedTaskId(pendingApprovals[0]?.taskId ?? null)}
            >
              Review Now
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Left Column - Tasks */}
          <div className="xl:col-span-4 space-y-6">
            <Card className="glass border-border/50 overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ListTodo className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Tasks</CardTitle>
                      <CardDescription className="text-xs">Manage your workflows</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Tabs defaultValue="active" className="w-full">
                  <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0 h-12">
                    <TabsTrigger 
                      value="active" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-4 h-12"
                    >
                      Active
                      <Badge variant="secondary" className="ml-2 bg-primary/10 text-primary text-[10px]">
                        {activeTasks.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger 
                      value="completed"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-4 h-12"
                    >
                      History
                      <Badge variant="secondary" className="ml-2 bg-muted text-muted-foreground text-[10px]">
                        {completedTasks.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="active" className="mt-0">
                    <ScrollArea className="h-[450px]">
                      <div className="p-4 space-y-3">
                        {activeTasks.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                              <Sparkles className="w-8 h-8 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm text-muted-foreground font-medium">No active tasks</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">Create a new task to get started</p>
                          </div>
                        ) : (
                          activeTasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isSelected={task.id === selectedTaskId}
                              onSelect={setSelectedTaskId}
                              onCancel={handleCancelTask}
                            />
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                  
                  <TabsContent value="completed" className="mt-0">
                    <ScrollArea className="h-[450px]">
                      <div className="p-4 space-y-3">
                        {completedTasks.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                              <Clock className="w-8 h-8 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm text-muted-foreground font-medium">No history yet</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">Completed tasks will appear here</p>
                          </div>
                        ) : (
                          completedTasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isSelected={task.id === selectedTaskId}
                              onSelect={setSelectedTaskId}
                            />
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Agent Pool & Details */}
          <div className="xl:col-span-8 space-y-6">
            {/* Agent Pool */}
            <Card className="glass border-border/50">
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Cpu className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Agent Pool</CardTitle>
                      <CardDescription className="text-xs">Real-time status of all AI agents</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-muted-foreground">Ready</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-muted-foreground">Busy</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-muted-foreground">Error</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <AgentGrid agents={agents} />
              </CardContent>
            </Card>

            {/* Pending Approvals */}
            {pendingApprovals.map(approval => (
              <PlanApproval
                key={approval.taskId}
                taskId={approval.taskId}
                plan={approval.plan}
                validatorFeedback={approval.validatorFeedback}
                onApprove={(id, fb) => handleApproval(id, 'approve', fb)}
                onReject={(id, fb) => handleApproval(id, 'reject', fb)}
                onModify={(id, fb) => handleApproval(id, 'modify', fb)}
              />
            ))}

            <Card className="glass border-border/50">
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Task Focus</CardTitle>
                      <CardDescription className="text-xs">
                        {selectedTask ? `Task #${selectedTask.id} live status` : 'Select a task to monitor'}
                      </CardDescription>
                    </div>
                  </div>
                  {selectedTask && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] uppercase tracking-wider font-medium",
                        statusBadgeStyles[selectedTask.status] || 'border-border text-muted-foreground'
                      )}
                    >
                      {selectedTask.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {selectedTask ? (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Objective</p>
                      <p className="text-sm text-foreground leading-relaxed">{selectedTask.user_input}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <p className="text-muted-foreground">Current phase</p>
                        <p className="text-sm font-semibold text-foreground">
                          {taskFocus?.currentPhase || selectedTask.status.replace('_', ' ')}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <p className="text-muted-foreground">Active subtask</p>
                        <p className="text-sm font-semibold text-foreground line-clamp-2">
                          {taskFocus?.currentSubtask || 'Waiting for update'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <p className="text-muted-foreground">Phase status</p>
                        <p className="text-sm font-semibold text-foreground capitalize">
                          {taskFocus?.phaseStatus || 'pending'}
                        </p>
                        {taskFocus?.totalSubtasks ? (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {taskFocus.completedSubtasks ?? 0}/{taskFocus.totalSubtasks} subtasks
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                        <span>Progress</span>
                        <span className="font-mono">{selectedTaskProgress}%</span>
                      </div>
                      <Progress value={selectedTaskProgress} className="h-2" />
                      {selectedTask?.stats?.total ? (
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          {selectedTask.stats.completed}/{selectedTask.stats.total} subtasks completed
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Latest update</p>
                      <p className="text-sm text-foreground mt-1">
                        {taskFocus?.lastEvent || 'Waiting for new events...'}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                        {taskFocus?.lastEventAt
                          ? new Date(taskFocus.lastEventAt).toLocaleTimeString('en-US', { hour12: false })
                          : '—'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                      <ListTodo className="w-6 h-6 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm text-muted-foreground font-medium">No task selected</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Pick a task from the left panel to follow its progress
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timeline */}
            {selectedTaskId && (
              <Card className="glass border-border/50">
                <CardHeader className="pb-4 border-b border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BarChart3 className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Execution Timeline</CardTitle>
                        <CardDescription className="text-xs">Task #{selectedTaskId} progress</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">
                      {timeline.length} events
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <Timeline events={timeline} maxHeight="320px" />
                </CardContent>
              </Card>
            )}

            <Card className="glass border-border/50">
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Live Activity</CardTitle>
                      <CardDescription className="text-xs">System-wide updates</CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">
                    {activityFeed.length} events
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Timeline events={activityFeed} maxHeight="240px" />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  color,
  iconClassName
}: { 
  title: string; 
  value: number; 
  icon: any; 
  trend: string; 
  color: 'primary' | 'success' | 'warning';
  iconClassName?: string;
}) {
  const colorClasses = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-emerald-500/10 text-emerald-500',
    warning: 'bg-amber-500/10 text-amber-500',
  };
  
  const valueColors = {
    primary: 'text-foreground',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
  };

  return (
    <Card className="glass border-border/50 glass-hover group">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
            <p className={cn("text-3xl font-bold mt-1", valueColors[color])}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{trend}</p>
          </div>
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110", colorClasses[color])}>
            <Icon className={cn("w-5 h-5", iconClassName)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

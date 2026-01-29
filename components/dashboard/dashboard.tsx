"use client"

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useWebSocket } from '@/hooks/use-websocket'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  Cpu,
  BarChart3,
  Sparkles
} from 'lucide-react'

import { AgentGrid } from './agent-grid'
import { Timeline } from './timeline'
import { PlanApproval } from './plan-approval'
import { TaskCard } from './task-card'
import { CreateTaskDialog } from './create-task-dialog'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

interface Task {
  id: number
  user_input: string
  status: string
  created_at: string
  completed_at?: string
  stats?: { total: number; completed: number; failed: number }
}

interface Agent {
  id: string
  model: 'gemini' | 'qwen'
  status: 'ready' | 'busy' | 'error' | 'circuit_breaker_open' | 'initializing'
  inUse: boolean
  circuitBreakerState: 'closed' | 'open' | 'half-open'
  totalExecutions: number
  failedExecutions: number
  successRate: number
}

interface TimelineEvent {
  id: string
  timestamp: string
  type: 'info' | 'success' | 'warning' | 'error' | 'approval_needed' | 'phase_start'
  message: string
  details?: any
}

interface PendingApproval {
  taskId: number
  plan: any
  validatorFeedback: any
}

export function Dashboard() {
  console.log("[v0] Dashboard component mounting")
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ total: 0, ready: 0, busy: 0 })

  const handleWebSocketMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'agent_pool_status':
        setAgents(message.payload.agents || [])
        setStats({
          total: message.payload.total || 0,
          ready: message.payload.ready || 0,
          busy: message.payload.busy || 0,
        })
        break

      case 'task_status_change':
        setTasks(prev => prev.map(t => 
          t.id === message.payload.taskId 
            ? { ...t, status: message.payload.status }
            : t
        ))
        break

      case 'timeline_update':
        if (message.payload.taskId === selectedTaskId) {
          setTimeline(prev => [...prev, {
            id: `${Date.now()}`,
            timestamp: message.timestamp || new Date().toISOString(),
            ...message.payload
          }])
        }
        break

      case 'plan_needs_approval':
        setPendingApprovals(prev => [
          ...prev.filter(p => p.taskId !== message.payload.taskId),
          message.payload
        ])
        break

      case 'approval_received':
        setPendingApprovals(prev => 
          prev.filter(p => p.taskId !== message.payload.taskId)
        )
        break

      case 'task_complete':
        fetchTasks()
        break
    }
  }, [selectedTaskId])

  const { isConnected, subscribe } = useWebSocket({
    url: WS_URL,
    onConnect: () => {
      if (selectedTaskId) subscribe(selectedTaskId)
    },
    onMessage: handleWebSocketMessage,
  })

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`)
      const data = await res.json()
      if (data.success) {
        setTasks(data.tasks || [])
      }
    } catch (e) {
      console.error('Failed to fetch tasks:', e)
    }
  }, [])

  const fetchAgentStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/agents/status`)
      const data = await res.json()
      if (data.success) {
        setAgents(data.agents || [])
        setStats(data.stats || { total: 0, ready: 0, busy: 0 })
      }
    } catch (e) {
      console.error('Failed to fetch agent status:', e)
    }
  }, [])

  const fetchPendingApprovals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/pending/approvals`)
      const data = await res.json()
      if (data.success) {
        setPendingApprovals(data.approvals || [])
      }
    } catch (e) {
      console.error('Failed to fetch pending approvals:', e)
    }
  }, [])

  const fetchTimeline = useCallback(async (taskId: number) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/timeline`)
      const data = await res.json()
      if (data.success) {
        setTimeline(data.events?.map((e: any, i: number) => ({
          id: `${i}`,
          timestamp: e.created_at,
          type: e.event_type,
          message: e.message,
          details: e.details ? JSON.parse(e.details) : null
        })) || [])
      }
    } catch (e) {
      console.error('Failed to fetch timeline:', e)
    }
  }, [])

  const handleCreateTask = async (data: { userInput: string; context?: string; autoApprove: boolean }) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (result.success) {
        fetchTasks()
        setSelectedTaskId(result.taskId)
        subscribe(result.taskId)
      }
    } catch (e) {
      console.error('Failed to create task:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleApproval = async (taskId: number, action: 'approve' | 'reject' | 'modify', feedback?: string) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback }),
      })
      const result = await res.json()
      if (result.success) {
        fetchTasks()
        fetchPendingApprovals()
      }
    } catch (e) {
      console.error('Failed to handle approval:', e)
    }
  }

  const handleCancelTask = async (taskId: number) => {
    try {
      await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: 'POST' })
      fetchTasks()
    } catch (e) {
      console.error('Failed to cancel task:', e)
    }
  }

  useEffect(() => {
    fetchTasks()
    fetchAgentStatus()
    fetchPendingApprovals()
  }, [fetchTasks, fetchAgentStatus, fetchPendingApprovals])

  useEffect(() => {
    if (selectedTaskId) {
      subscribe(selectedTaskId)
      fetchTimeline(selectedTaskId)
    }
  }, [selectedTaskId, subscribe, fetchTimeline])

  const activeTasks = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const completedTasks = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
  const successRate = stats.total > 0 ? ((stats.ready / stats.total) * 100).toFixed(0) : '0'

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
              onClick={() => { fetchTasks(); fetchAgentStatus() }}
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
            <Button variant="outline" size="sm" className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10">
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
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  color,
  iconClassName
}: { 
  title: string
  value: number
  icon: any
  trend: string
  color: 'primary' | 'success' | 'warning'
  iconClassName?: string
}) {
  const colorClasses = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-emerald-500/10 text-emerald-500',
    warning: 'bg-amber-500/10 text-amber-500',
  }
  
  const valueColors = {
    primary: 'text-foreground',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
  }

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
  )
}

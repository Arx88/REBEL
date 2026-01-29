"use client"

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { 
  CheckCircle2, 
  XCircle, 
  Edit3, 
  ChevronDown,
  AlertTriangle,
  Target,
  Layers,
  MessageSquare,
  Zap,
  Bot,
  Sparkles
} from 'lucide-react'

interface Phase {
  name: string
  why_necessary: string
  subtasks: Array<{
    id: string
    description: string
    assigned_agent_type: string
    deliverable: string
    estimated_complexity: number
  }>
}

interface Plan {
  objective: string
  phases: Phase[]
  success_criteria: string[]
}

interface ValidatorFeedback {
  approved: boolean
  confidence: number
  issues?: string[]
  suggestions?: string[]
}

interface PlanApprovalProps {
  taskId: number
  plan: Plan
  validatorFeedback?: ValidatorFeedback
  onApprove: (taskId: number, feedback?: string) => void
  onReject: (taskId: number, feedback?: string) => void
  onModify: (taskId: number, feedback: string) => void
  loading?: boolean
  className?: string
}

export function PlanApproval({
  taskId,
  plan,
  validatorFeedback,
  onApprove,
  onReject,
  onModify,
  loading = false,
  className,
}: PlanApprovalProps) {
  const [feedback, setFeedback] = useState('')
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([0]))

  const togglePhase = (index: number) => {
    const newExpanded = new Set(expandedPhases)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedPhases(newExpanded)
  }

  const totalSubtasks = plan.phases.reduce((sum, phase) => sum + phase.subtasks.length, 0)

  return (
    <Card className={cn(
      'glass border-amber-500/30 overflow-hidden',
      className
    )}>
      <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500" />
      
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center animate-pulse-glow">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                Plan Awaiting Approval
                <Badge variant="outline" className="text-xs font-mono border-amber-500/30 text-amber-500">
                  #{taskId}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-0.5">
                Review and approve to begin execution
              </CardDescription>
            </div>
          </div>
          {validatorFeedback && (
            <div className="flex flex-col items-end gap-1">
              <Badge 
                variant="outline"
                className={cn(
                  "text-xs font-semibold",
                  validatorFeedback.approved 
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' 
                    : 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                )}
              >
                {validatorFeedback.approved ? 'Validator Approved' : 'Needs Review'}
              </Badge>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Confidence</span>
                <Progress value={validatorFeedback.confidence} className="w-16 h-1.5" />
                <span className="text-xs font-semibold text-foreground">{validatorFeedback.confidence}%</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Objective</h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{plan.objective}</p>
        </div>

        {validatorFeedback?.issues && validatorFeedback.issues.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h4 className="text-sm font-semibold text-amber-500">Validator Issues</h4>
            </div>
            <ul className="space-y-2">
              {validatorFeedback.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Execution Plan</h4>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="px-2 py-1 rounded-md bg-muted/50">{plan.phases.length} phases</span>
              <span className="px-2 py-1 rounded-md bg-muted/50">{totalSubtasks} subtasks</span>
            </div>
          </div>
          
          <ScrollArea className="max-h-[320px]">
            <div className="space-y-2 pr-4">
              {plan.phases.map((phase, index) => (
                <Collapsible 
                  key={index} 
                  open={expandedPhases.has(index)}
                  onOpenChange={() => togglePhase(index)}
                >
                  <CollapsibleTrigger className="w-full group">
                    <div className={cn(
                      "flex items-center justify-between p-3 rounded-xl border transition-all duration-300",
                      expandedPhases.has(index) 
                        ? "bg-primary/5 border-primary/30" 
                        : "bg-muted/30 border-border/50 hover:bg-muted/50 hover:border-primary/20"
                    )}>
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "w-7 h-7 rounded-lg text-xs flex items-center justify-center font-bold transition-colors",
                          expandedPhases.has(index) 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-muted text-muted-foreground"
                        )}>
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-foreground">{phase.name}</span>
                        <Badge variant="secondary" className="text-[10px] bg-muted/50">
                          {phase.subtasks.length} tasks
                        </Badge>
                      </div>
                      <ChevronDown className={cn(
                        'w-4 h-4 text-muted-foreground transition-transform duration-300',
                        expandedPhases.has(index) && 'rotate-180 text-primary'
                      )} />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 ml-4 pl-6 border-l border-border/50 space-y-3 py-2">
                      <p className="text-xs text-muted-foreground italic">{phase.why_necessary}</p>
                      {phase.subtasks.map((subtask) => (
                        <div 
                          key={subtask.id} 
                          className="p-3 rounded-lg bg-card/50 border border-border/50 hover:border-primary/20 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                              {subtask.id}
                            </span>
                            <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary">
                              <Bot className="w-3 h-3" />
                              {subtask.assigned_agent_type}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground mb-1">{subtask.description}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {subtask.deliverable}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <h4 className="text-sm font-semibold text-emerald-500">Success Criteria</h4>
          </div>
          <ul className="space-y-2">
            {plan.success_criteria.map((criteria, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                {criteria}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">
              Feedback
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            </h4>
          </div>
          <Textarea
            placeholder="Add feedback, suggestions, or modifications you'd like to see..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className={cn(
              "min-h-[80px] text-sm resize-none",
              "bg-muted/30 border-border/50 focus:border-primary/50"
            )}
          />
        </div>
      </CardContent>

      <CardFooter className="flex justify-end gap-3 p-6 pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onReject(taskId, feedback)}
          disabled={loading}
          className="border-red-500/30 text-red-400 hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/50"
        >
          <XCircle className="w-4 h-4 mr-1.5" />
          Reject
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onModify(taskId, feedback)}
          disabled={loading || !feedback.trim()}
          className="border-amber-500/30 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 hover:border-amber-500/50"
        >
          <Edit3 className="w-4 h-4 mr-1.5" />
          Request Changes
        </Button>
        <Button
          size="sm"
          onClick={() => onApprove(taskId, feedback)}
          disabled={loading}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold shadow-lg shadow-emerald-500/20"
        >
          <CheckCircle2 className="w-4 h-4 mr-1.5" />
          Approve & Execute
        </Button>
      </CardFooter>
    </Card>
  )
}

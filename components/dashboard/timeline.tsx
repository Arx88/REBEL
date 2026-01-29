"use client"

import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Info,
  Clock,
  Zap,
  Play
} from 'lucide-react'

interface TimelineEvent {
  id: string
  timestamp: string
  type: 'info' | 'success' | 'warning' | 'error' | 'approval_needed' | 'phase_start'
  message: string
  details?: any
}

interface TimelineProps {
  events: TimelineEvent[]
  className?: string
  maxHeight?: string
}

const eventConfig = {
  info: {
    icon: Info,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    line: 'bg-blue-500/30',
    label: 'Info',
  },
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    line: 'bg-emerald-500/50',
    label: 'Success',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    line: 'bg-amber-500/30',
    label: 'Warning',
  },
  error: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    line: 'bg-red-500/30',
    label: 'Error',
  },
  approval_needed: {
    icon: Clock,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    line: 'bg-purple-500/30',
    label: 'Approval',
  },
  phase_start: {
    icon: Zap,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    line: 'bg-cyan-500/50',
    label: 'Phase',
  },
}

export function Timeline({ events, className, maxHeight = '400px' }: TimelineProps) {
  if (events.length === 0) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center py-16 text-center',
        className
      )}>
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <Play className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">No events yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Events will appear as the task executes</p>
      </div>
    )
  }

  return (
    <ScrollArea className={className} style={{ maxHeight }}>
      <div className="space-y-1 pr-4">
        {events.map((event, index) => (
          <TimelineItem 
            key={event.id || index} 
            event={event} 
            isLast={index === events.length - 1}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function TimelineItem({ 
  event, 
  isLast
}: { 
  event: TimelineEvent
  isLast: boolean
}) {
  const config = eventConfig[event.type] || eventConfig.info
  const Icon = config.icon

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false
    })
  }

  const isPhase = event.type === 'phase_start'

  return (
    <div className={cn(
      'group relative',
      isPhase && 'mt-4 mb-2'
    )}>
      {isPhase ? (
        <div className={cn(
          'flex items-center gap-3 p-3 rounded-xl',
          'bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent',
          'border border-cyan-500/20'
        )}>
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            'bg-gradient-to-br from-cyan-500 to-primary'
          )}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-cyan-400 truncate">{event.message}</p>
              <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400 shrink-0">
                {config.label}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">{formatTime(event.timestamp)}</p>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 py-2">
          <div className="flex flex-col items-center w-6 shrink-0">
            <div className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center transition-all',
              config.bg,
              config.border,
              'border',
              'group-hover:scale-110'
            )}>
              <Icon className={cn('w-3 h-3', config.color)} />
            </div>
            {!isLast && (
              <div className={cn(
                'w-px flex-1 mt-1',
                config.line
              )} />
            )}
          </div>
          
          <div className={cn(
            'flex-1 pb-3 min-w-0',
            'group-hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors'
          )}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-foreground leading-relaxed">{event.message}</p>
              <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap mt-0.5">
                {formatTime(event.timestamp)}
              </span>
            </div>
            
            {event.details && (
              <div className={cn(
                'mt-2 p-2 rounded-lg text-xs font-mono',
                'bg-muted/50 border border-border/50',
                'max-h-20 overflow-auto'
              )}>
                {typeof event.details === 'string' 
                  ? <span className="text-muted-foreground">{event.details}</span>
                  : (
                    <pre className="text-muted-foreground whitespace-pre-wrap break-words">
                      {JSON.stringify(event.details, null, 2).substring(0, 200)}
                      {JSON.stringify(event.details).length > 200 && '...'}
                    </pre>
                  )
                }
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

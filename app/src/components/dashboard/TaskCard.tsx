import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ChevronRight,
  X,
  Pause,
  Sparkles,
  AlertCircle,
  AlertTriangle
} from 'lucide-react';

interface Task {
  id: number;
  user_input: string;
  status: string;
  created_at: string;
  completed_at?: string;
  stats?: { total: number; completed: number; failed: number };
}

interface TaskCardProps {
  task: Task;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
  onCancel?: (id: number) => void;
}

const statusConfig: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bg: string;
  border: string;
  animate?: boolean;
}> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
  },
  planning: {
    icon: Sparkles,
    label: 'Planning',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    animate: true,
  },
  validating: {
    icon: Loader2,
    label: 'Validating',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    animate: true,
  },
  validating_plan: {
    icon: Loader2,
    label: 'Validating',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    animate: true,
  },
  awaiting_approval: {
    icon: Pause,
    label: 'Awaiting Approval',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  orchestrating: {
    icon: Loader2,
    label: 'Orchestrating',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    animate: true,
  },
  executing: {
    icon: Loader2,
    label: 'Executing',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    animate: true,
  },
  synthesizing: {
    icon: Loader2,
    label: 'Synthesizing',
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
  cancelled: {
    icon: AlertCircle,
    label: 'Cancelled',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
  },
  paused: {
    icon: Pause,
    label: 'Paused',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
  },
};

export function TaskCard({ task, isSelected, onSelect, onCancel }: TaskCardProps) {
  const config = statusConfig[task.status] || statusConfig.pending;
  const Icon = config.icon;
  
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isActive = !['completed', 'failed', 'cancelled'].includes(task.status);
  const canCancel = isActive && onCancel;
  const progress = task.stats && task.stats.total > 0 
    ? Math.round((task.stats.completed / task.stats.total) * 100) 
    : 0;

  return (
    <div
      onClick={() => onSelect?.(task.id)}
      className={cn(
        'group relative p-4 rounded-xl cursor-pointer transition-all duration-300',
        'border bg-card/50 backdrop-blur-sm',
        isSelected 
          ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/5' 
          : 'border-border/50 hover:border-primary/30 hover:bg-muted/30'
      )}
    >
      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-primary" />
      )}
      
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform',
          config.bg,
          config.border,
          'border',
          'group-hover:scale-105'
        )}>
          <Icon className={cn(
            'w-5 h-5',
            config.color,
            config.animate && 'animate-spin'
          )} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{task.id}</span>
              <Badge 
                variant="outline" 
                className={cn(
                  'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0',
                  config.border,
                  config.color
                )}
              >
                {config.label}
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatDate(task.created_at)}
            </span>
          </div>
          
          <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
            {task.user_input}
          </p>
          
          {/* Progress bar for active tasks */}
          {task.stats && task.stats.total > 0 && isActive && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-muted-foreground">Progress</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {task.stats.completed}/{task.stats.total}
                </span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
          
          {/* Completed stats */}
          {task.stats && !isActive && task.status === 'completed' && (
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="text-xs text-muted-foreground">
                {task.stats.completed} subtasks completed
              </span>
            </div>
          )}
          
          {/* Failed indicator */}
          {task.stats && task.stats.failed > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle className="w-3 h-3 text-red-500" />
              <span className="text-xs text-red-400">{task.stats.failed} failed</span>
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {canCancel && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(task.id);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          <ChevronRight className={cn(
            'w-4 h-4 text-muted-foreground transition-transform',
            isSelected && 'text-primary rotate-90'
          )} />
        </div>
      </div>
    </div>
  );
}

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Zap, AlertTriangle, TrendingUp, Activity } from 'lucide-react';

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

interface AgentGridProps {
  agents: Agent[];
  className?: string;
}

const statusConfig = {
  ready: {
    color: 'bg-emerald-500',
    glow: 'shadow-emerald-500/30',
    ring: 'ring-emerald-500/30',
    label: 'Ready',
    animate: false,
  },
  busy: {
    color: 'bg-amber-500',
    glow: 'shadow-amber-500/30',
    ring: 'ring-amber-500/30',
    label: 'Processing',
    animate: true,
  },
  error: {
    color: 'bg-red-500',
    glow: 'shadow-red-500/30',
    ring: 'ring-red-500/30',
    label: 'Error',
    animate: false,
  },
  circuit_breaker_open: {
    color: 'bg-red-700',
    glow: 'shadow-red-700/30',
    ring: 'ring-red-700/30',
    label: 'Circuit Open',
    animate: false,
  },
  initializing: {
    color: 'bg-slate-400',
    glow: 'shadow-slate-400/30',
    ring: 'ring-slate-400/30',
    label: 'Starting',
    animate: true,
  },
};

const modelConfig = {
  gemini: {
    gradient: 'from-blue-500 to-cyan-400',
    border: 'border-blue-500/40',
    label: 'Gemini',
    icon: '//storage.googleapis.com/gweb-uniblog-publish-prod/images/gemini.width-1000.format-webp.webp',
  },
  qwen: {
    gradient: 'from-purple-500 to-pink-400',
    border: 'border-purple-500/40',
    label: 'Qwen',
    icon: null,
  },
};

export function AgentGrid({ agents, className }: AgentGridProps) {
  const geminiAgents = agents.filter(a => a.model === 'gemini');
  const qwenAgents = agents.filter(a => a.model === 'qwen');

  const getStats = (agentList: Agent[]) => ({
    total: agentList.length,
    ready: agentList.filter(a => a.status === 'ready').length,
    busy: agentList.filter(a => a.status === 'busy').length,
    error: agentList.filter(a => a.status === 'error' || a.status === 'circuit_breaker_open').length,
    avgSuccess: agentList.length > 0 
      ? agentList.reduce((sum, a) => sum + a.successRate, 0) / agentList.length 
      : 0,
    totalExec: agentList.reduce((sum, a) => sum + a.totalExecutions, 0),
  });

  return (
    <div className={cn('space-y-8', className)}>
      <AgentSection 
        title="Gemini Fleet" 
        agents={geminiAgents} 
        model="gemini" 
        stats={getStats(geminiAgents)}
      />
      <AgentSection 
        title="Qwen Fleet" 
        agents={qwenAgents} 
        model="qwen"
        stats={getStats(qwenAgents)}
      />
    </div>
  );
}

function AgentSection({ 
  title, 
  agents, 
  model,
  stats
}: { 
  title: string; 
  agents: Agent[]; 
  model: 'gemini' | 'qwen';
  stats: {
    total: number;
    ready: number;
    busy: number;
    error: number;
    avgSuccess: number;
    totalExec: number;
  };
}) {
  const config = modelConfig[model];
  const availabilityPercent = stats.total > 0 ? (stats.ready / stats.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center",
            config.gradient
          )}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{stats.total} agents total</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-xs">
            <MetricPill value={stats.ready} label="Ready" color="emerald" />
            <MetricPill value={stats.busy} label="Busy" color="amber" />
            {stats.error > 0 && <MetricPill value={stats.error} label="Error" color="red" />}
          </div>
          
          <div className="w-32">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Availability</span>
              <span className="text-xs font-semibold text-foreground">{availabilityPercent.toFixed(0)}%</span>
            </div>
            <Progress 
              value={availabilityPercent} 
              className="h-1.5 bg-muted"
            />
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-10 sm:grid-cols-15 lg:grid-cols-20 gap-1.5">
        <TooltipProvider delayDuration={100}>
          {agents.map(agent => (
            <AgentCell key={agent.id} agent={agent} />
          ))}
          {/* Fill empty slots for visual consistency */}
          {agents.length < 20 && Array.from({ length: Math.max(0, 20 - agents.length) }).map((_, i) => (
            <div 
              key={`empty-${i}`} 
              className="aspect-square rounded-md border border-dashed border-border/30 bg-muted/10" 
            />
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
}

function MetricPill({ value, label, color }: { value: number; label: string; color: 'emerald' | 'amber' | 'red' }) {
  const colorClasses = {
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
    red: 'bg-red-500/10 text-red-500',
  };
  
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full", colorClasses[color])}>
      <span className="font-semibold">{value}</span>
      <span className="text-[10px] opacity-70">{label}</span>
    </div>
  );
}

function AgentCell({ agent }: { agent: Agent }) {
  const status = statusConfig[agent.status];
  const model = modelConfig[agent.model];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'aspect-square rounded-lg cursor-pointer transition-all duration-300',
            'hover:scale-125 hover:z-10 relative group',
            'border',
            model.border,
            status.animate && 'animate-pulse'
          )}
        >
          {/* Background with status color */}
          <div className={cn(
            'absolute inset-0 rounded-lg transition-all duration-300',
            status.color,
            'group-hover:shadow-lg',
            status.glow && 'group-hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]'
          )} />
          
          {/* Glow effect on hover */}
          <div className={cn(
            'absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity',
            'ring-2',
            status.ring
          )} />
          
          {/* Busy indicator */}
          {agent.status === 'busy' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1/3 h-1/3 rounded-full bg-white/30 animate-ping" />
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="p-0 overflow-hidden bg-card/95 backdrop-blur-xl border-border/50"
      >
        <div className="p-3 min-w-[200px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-6 h-6 rounded-md bg-gradient-to-br flex items-center justify-center",
                model.gradient
              )}>
                <Zap className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-sm">{agent.id}</span>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] uppercase tracking-wider font-medium",
                agent.status === 'ready' && 'border-emerald-500/50 text-emerald-500',
                agent.status === 'busy' && 'border-amber-500/50 text-amber-500',
                (agent.status === 'error' || agent.status === 'circuit_breaker_open') && 'border-red-500/50 text-red-500',
                agent.status === 'initializing' && 'border-slate-400/50 text-slate-400'
              )}
            >
              {status.label}
            </Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Executions
              </span>
              <span className="font-medium">{agent.totalExecutions.toLocaleString()}</span>
            </div>
            
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                Success Rate
              </span>
              <span className={cn(
                "font-medium",
                agent.successRate >= 95 && 'text-emerald-500',
                agent.successRate >= 80 && agent.successRate < 95 && 'text-amber-500',
                agent.successRate < 80 && 'text-red-500'
              )}>
                {agent.successRate.toFixed(1)}%
              </span>
            </div>

            {agent.currentModel && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Model
                </span>
                <span className={cn(
                  "font-medium",
                  agent.usingFallback ? 'text-amber-500' : 'text-foreground'
                )}>
                  {agent.currentModel}
                </span>
              </div>
            )}

            {agent.usingFallback && (
              <div className="flex items-center gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 mt-2">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] text-amber-400 font-medium">
                  Using fallback model
                </span>
              </div>
            )}
            
            {agent.circuitBreakerState !== 'closed' && (
              <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-500/10 border border-red-500/20 mt-2">
                <AlertTriangle className="w-3 h-3 text-red-500" />
                <span className="text-[10px] text-red-400 font-medium">
                  Circuit Breaker: {agent.circuitBreakerState}
                </span>
              </div>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

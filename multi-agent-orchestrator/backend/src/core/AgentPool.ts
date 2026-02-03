import { CLIExecutor, CLIResponse } from './CLIExecutor';
import { EventEmitter } from 'events';
import { socketManager } from '../websocket/socketManager';

export interface PoolConfig {
  geminiCLIPath: string;
  qwenCLIPath: string;
  maxGeminiAgents: number;
  maxQwenAgents: number;
  initializationTimeout?: number;
  healthCheckInterval?: number;
}

export interface PooledAgent {
  executor: CLIExecutor;
  id: string;
  model: 'gemini' | 'qwen';
  index: number;
  inUse: boolean;
  lastUsed: number;
  totalExecutions: number;
  failedExecutions: number;
}

export interface AgentHealthStatus {
  id: string;
  model: 'gemini' | 'qwen';
  status: 'ready' | 'busy' | 'error' | 'circuit_breaker_open' | 'initializing';
  inUse: boolean;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  totalExecutions: number;
  failedExecutions: number;
  successRate: number;
  lastUsed: number;
  currentModel: string;
  usingFallback: boolean;
}

export class AgentPool extends EventEmitter {
  private agents: Map<string, PooledAgent> = new Map();
  private geminiQueue: string[] = [];
  private qwenQueue: string[] = [];
  private waitingResolvers: Map<string, ((agent: PooledAgent) => void)[]> = new Map();
  private config: PoolConfig;
  private healthCheckIntervalId: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    this.config = {
      geminiCLIPath: config.geminiCLIPath || 'gemini',
      qwenCLIPath: config.qwenCLIPath || 'qwen',
      maxGeminiAgents: config.maxGeminiAgents || 10,
      maxQwenAgents: config.maxQwenAgents || 10,
      initializationTimeout: config.initializationTimeout || 60000,
      healthCheckInterval: config.healthCheckInterval || 30000
    };
  }

  async initialize(): Promise<void> {
    console.log('Initializing AgentPool...');
    console.log(`   Gemini: ${this.config.maxGeminiAgents} agents`);
    console.log(`   Qwen: ${this.config.maxQwenAgents} agents`);

    const initPromises: Promise<void>[] = [];

    // Initialize Gemini agents
    for (let i = 0; i < this.config.maxGeminiAgents; i++) {
      initPromises.push(this.initializeAgent('gemini', i));
    }

    // Initialize Qwen agents
    for (let i = 0; i < this.config.maxQwenAgents; i++) {
      initPromises.push(this.initializeAgent('qwen', i));
    }

    // Wait for all with timeout
    await Promise.race([
      Promise.allSettled(initPromises),
      new Promise<void>((_, reject) => 
        setTimeout(() => reject(new Error('Pool initialization timeout')), this.config.initializationTimeout)
      )
    ]).catch(error => {
      console.warn('Pool initialization warning:', error.message);
    });

    const readyCount = Array.from(this.agents.values()).filter(a => 
      a.executor.getStatus().isReady
    ).length;
    
    console.log(`\nPool initialized: ${readyCount}/${this.agents.size} agents ready`);
    this.emit('initialized', { readyCount, total: this.agents.size });

    // Start health check
    this.startHealthCheck();
  }

  private async initializeAgent(model: 'gemini' | 'qwen', index: number): Promise<void> {
    const agentId = `${model}-${index + 1}`;
    const cliPath = model === 'gemini' ? this.config.geminiCLIPath : this.config.qwenCLIPath;

    const executor = new CLIExecutor({
      command: cliPath,
      args: [],
      model,
      agentId
    });

    const agent: PooledAgent = {
      executor,
      id: agentId,
      model,
      index,
      inUse: false,
      lastUsed: Date.now(),
      totalExecutions: 0,
      failedExecutions: 0
    };

    this.agents.set(agentId, agent);
    
    if (model === 'gemini') {
      this.geminiQueue.push(agentId);
    } else {
      this.qwenQueue.push(agentId);
    }

    // Set up circuit breaker listener
    executor.on('circuit_breaker_open', ({ agentId }) => {
      console.warn(`[AgentPool] Circuit breaker opened for ${agentId}`);
      this.emit('circuit_breaker_open', { agentId, model });
    });

    executor.on('reconnected', ({ agentId }) => {
      console.log(`[AgentPool] Agent ${agentId} reconnected`);
      this.emit('agent_reconnected', { agentId, model });
    });

    executor.on('reconnect_failed', ({ agentId, error }) => {
      console.error(`[AgentPool] Agent ${agentId} reconnect failed:`, error);
      this.emit('agent_reconnect_failed', { agentId, model, error });
    });

    executor.on('model_fallback', (data) => {
      socketManager.notifyModelFallback(data.taskId ?? null, {
        agentId: data.agentId,
        fromModel: data.fromModel,
        toModel: data.toModel,
        reason: data.reason,
        fallbackAttempt: data.fallbackAttempt,
        maxAttempts: data.maxAttempts
      });
    });

    executor.on('model_restored', (data) => {
      socketManager.notifyModelRestored(data.taskId ?? null, {
        agentId: data.agentId,
        model: data.model
      });
    });

    try {
      await executor.initialize();
      console.log(`  [OK] ${agentId} ready`);
      this.emit('agent_ready', { agentId, model });
    } catch (error) {
      console.error(`  [FAIL] ${agentId}:`, error);
      this.emit('agent_error', { agentId, model, error });
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
    }

    this.healthCheckIntervalId = setInterval(() => {
      if (this.isShuttingDown) return;
      
      const stats = this.getStats();
      const unhealthyAgents = this.getUnhealthyAgents();
      
      if (unhealthyAgents.length > 0) {
        console.log(`[AgentPool] Health check: ${unhealthyAgents.length} unhealthy agents`);
        
        // Try to recover unhealthy agents
        for (const agent of unhealthyAgents) {
          if (!agent.inUse) {
            this.tryRecoverAgent(agent.id);
          }
        }
      }

      this.emit('health_check', { stats, unhealthyAgents });
    }, this.config.healthCheckInterval);
  }

  private getUnhealthyAgents(): PooledAgent[] {
    return Array.from(this.agents.values()).filter(agent => {
      const status = agent.executor.getStatus();
      return !status.isReady || status.circuitBreakerState === 'open';
    });
  }

  private async tryRecoverAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.inUse) return;

    console.log(`[AgentPool] Attempting to recover agent ${agentId}`);
    
    try {
      // Reset circuit breaker and reinitialize
      agent.executor.resetCircuitBreaker();
      await agent.executor.initialize();
      console.log(`[AgentPool] Agent ${agentId} recovered`);
      this.emit('agent_recovered', { agentId, model: agent.model });
    } catch (error) {
      console.error(`[AgentPool] Failed to recover agent ${agentId}:`, error);
    }
  }

  async acquireAgent(model: 'gemini' | 'qwen', timeoutMs: number = 30000): Promise<PooledAgent> {
    const queue = model === 'gemini' ? this.geminiQueue : this.qwenQueue;

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        // Remove from waiting queue
        const waiting = this.waitingResolvers.get(model);
        if (waiting) {
          const index = waiting.indexOf(resolveWrapper);
          if (index > -1) waiting.splice(index, 1);
        }
        reject(new Error(`Timeout acquiring ${model} agent after ${timeoutMs}ms`));
      }, timeoutMs);

      const resolveWrapper = (agent: PooledAgent) => {
        clearTimeout(timeoutId);
        resolve(agent);
      };

      // Find available agent (prefer ones with circuit breaker closed)
      const availableAgentId = queue.find(id => {
        const agent = this.agents.get(id);
        if (!agent || agent.inUse) return false;
        
        const status = agent.executor.getStatus();
        return status.isReady && status.circuitBreakerState !== 'open';
      });

      if (availableAgentId) {
        const agent = this.agents.get(availableAgentId)!;
        agent.inUse = true;
        agent.lastUsed = Date.now();
        clearTimeout(timeoutId);
        this.emit('agent_acquired', { agentId: agent.id, model });
        resolve(agent);
        return;
      }

      // No available agent, add to waiting queue
      if (!this.waitingResolvers.has(model)) {
        this.waitingResolvers.set(model, []);
      }
      this.waitingResolvers.get(model)!.push(resolveWrapper);
    });
  }

  releaseAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.inUse = false;
    this.emit('agent_released', { agentId, model: agent.model });

    // Check for waiting requests
    const waiting = this.waitingResolvers.get(agent.model);
    if (waiting && waiting.length > 0) {
      const status = agent.executor.getStatus();
      
      // Only assign if agent is healthy
      if (status.isReady && status.circuitBreakerState !== 'open') {
        const nextResolver = waiting.shift();
        if (nextResolver) {
          agent.inUse = true;
          agent.lastUsed = Date.now();
          this.emit('agent_acquired', { agentId, model: agent.model });
          nextResolver(agent);
        }
      }
    }
  }

  async executeWithAgent(
    model: 'gemini' | 'qwen', 
    prompt: string, 
    context?: string,
    timeoutMs?: number,
    taskId?: number
  ): Promise<CLIResponse> {
    const agent = await this.acquireAgent(model, timeoutMs);
    
    try {
      agent.totalExecutions++;
      const result = await agent.executor.execute(prompt, context, taskId);
      
      if (!result.success) {
        agent.failedExecutions++;
      }
      
      return result;
    } catch (error) {
      agent.failedExecutions++;
      throw error;
    } finally {
      this.releaseAgent(agent.id);
    }
  }

  getStats() {
    const allAgents = Array.from(this.agents.values());
    
    const calculateStats = (agents: PooledAgent[]) => {
      const ready = agents.filter(a => a.executor.getStatus().isReady);
      const totalExecutions = agents.reduce((sum, a) => sum + a.totalExecutions, 0);
      const failedExecutions = agents.reduce((sum, a) => sum + a.failedExecutions, 0);
      
      return {
        total: agents.length,
        ready: ready.length,
        busy: agents.filter(a => a.inUse).length,
        idle: ready.filter(a => !a.inUse).length,
        circuitBreakerOpen: agents.filter(a => 
          a.executor.getStatus().circuitBreakerState === 'open'
        ).length,
        totalExecutions,
        failedExecutions,
        successRate: totalExecutions > 0 
          ? ((totalExecutions - failedExecutions) / totalExecutions * 100).toFixed(1)
          : '100.0'
      };
    };

    const geminiAgents = allAgents.filter(a => a.model === 'gemini');
    const qwenAgents = allAgents.filter(a => a.model === 'qwen');

    return {
      ...calculateStats(allAgents),
      gemini: calculateStats(geminiAgents),
      qwen: calculateStats(qwenAgents),
      waitingRequests: {
        gemini: this.waitingResolvers.get('gemini')?.length || 0,
        qwen: this.waitingResolvers.get('qwen')?.length || 0
      }
    };
  }

  getAgentStatuses(): AgentHealthStatus[] {
    return Array.from(this.agents.values()).map(agent => {
      const executorStatus = agent.executor.getStatus();
      const cbState = agent.executor.getCircuitBreakerState();
      
      let status: AgentHealthStatus['status'] = 'error';
      if (executorStatus.isReady) {
        if (cbState.state === 'open') {
          status = 'circuit_breaker_open';
        } else if (agent.inUse) {
          status = 'busy';
        } else {
          status = 'ready';
        }
      }

      const successRate = agent.totalExecutions > 0
        ? (agent.totalExecutions - agent.failedExecutions) / agent.totalExecutions * 100
        : 100;

      return {
        id: agent.id,
        model: agent.model,
        status,
        inUse: agent.inUse,
        circuitBreakerState: cbState.state,
        totalExecutions: agent.totalExecutions,
        failedExecutions: agent.failedExecutions,
        successRate,
        lastUsed: agent.lastUsed,
        currentModel: executorStatus.currentModel.id,
        usingFallback: executorStatus.currentModel.usingFallback
      };
    });
  }

  async destroy(): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
    }

    // Reject all waiting requests
    for (const [model, resolvers] of this.waitingResolvers) {
      for (const resolver of resolvers) {
        // Note: These will timeout instead since we can't reject a resolver
      }
    }
    this.waitingResolvers.clear();

    // Destroy all agents
    const destroyPromises = Array.from(this.agents.values()).map(agent =>
      agent.executor.destroy().catch(e => 
        console.error(`Error destroying ${agent.id}:`, e)
      )
    );

    await Promise.allSettled(destroyPromises);
    
    this.agents.clear();
    this.geminiQueue = [];
    this.qwenQueue = [];
    
    console.log('[AgentPool] Destroyed');
  }
}

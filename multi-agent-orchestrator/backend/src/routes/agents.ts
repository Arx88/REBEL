import { Router } from 'express';
import { AgentPool } from '../core/AgentPool';
import { socketManager } from '../websocket/socketManager';

export function createAgentsRouter(agentPool: AgentPool): Router {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({
      success: true,
      stats: agentPool.getStats(),
      agents: agentPool.getAgentStatuses()
    });
  });

  router.get('/health', (req, res) => {
    const stats = agentPool.getStats();
    const healthy = stats.ready > 0;
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      healthy,
      stats: { total: stats.total, ready: stats.ready, busy: stats.busy }
    });
  });

  return router;
}
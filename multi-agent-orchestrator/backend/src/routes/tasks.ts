import { Router } from 'express';
import Database from 'better-sqlite3';
import { AgentPool } from '../core/AgentPool';
import { MemoryManager } from '../core/MemoryManager';
import { TaskController } from '../controllers/TaskController';

export function createTaskRouter(db: Database.Database, agentPool: AgentPool, memoryManager: MemoryManager): Router {
  const router = Router();
  const controller = new TaskController(db, agentPool, memoryManager);

  // Task CRUD
  router.post('/', (req, res) => controller.createTask(req, res));
  router.get('/', (req, res) => controller.listTasks(req, res));
  router.get('/:id', (req, res) => controller.getTask(req, res));
  
  // Task details
  router.get('/:id/timeline', (req, res) => controller.getTaskTimeline(req, res));
  router.get('/:id/executions', (req, res) => controller.getTaskExecutions(req, res));
  
  // Task lifecycle control
  router.post('/:id/cancel', (req, res) => controller.cancelTask(req, res));
  router.post('/:id/pause', (req, res) => controller.pauseTask(req, res));
  router.post('/:id/resume', (req, res) => controller.resumeTask(req, res));
  
  // Human-in-the-Loop: Plan Approval
  router.post('/:id/approve', (req, res) => controller.handlePlanApproval(req, res));
  router.get('/pending/approvals', (req, res) => controller.getPendingApprovals(req, res));

  return router;
}

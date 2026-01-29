import { BaseCLIAgent } from './BaseCLIAgent';
import { MASTER_PLANNER_PROMPT } from '../prompts';
import { Plan } from '../../../shared/types';

export interface PlanningResult {
  success: boolean;
  plan?: Plan;
  rawResponse: string;
  iterations: number;
  executionTime: number;
}

export class MasterPlanner extends BaseCLIAgent {
  constructor(agentPool: any, memoryManager: any, db: any) {
    super(agentPool, memoryManager, db, { agentType: 'master_planner', model: 'gemini' });
  }

  async execute(taskId: number, userInput: string, projectContext: string = ''): Promise<PlanningResult> {
    console.log(`[MasterPlanner] Planificando tarea ${taskId}`);
    const startTime = Date.now();

    const prompt = MASTER_PLANNER_PROMPT(userInput, projectContext);
    const result = await this.executePrompt(taskId, 'planning', prompt, undefined, 'Generación de plan');

    if (!result.success) {
      return { success: false, rawResponse: result.data, iterations: 1, executionTime: result.executionTime };
    }

    const parsedPlan = this.extractJSON<Plan>(result.data);

    if (parsedPlan && this.validatePlanStructure(parsedPlan)) {
      this.saveToMemory(taskId, 'final_plan', parsedPlan);
      return { success: true, plan: parsedPlan, rawResponse: result.data, iterations: 1, executionTime: Date.now() - startTime };
    }

    return { success: false, rawResponse: result.data, iterations: 1, executionTime: Date.now() - startTime };
  }

  private validatePlanStructure(plan: Plan): boolean {
    if (!plan.objective || !Array.isArray(plan.phases) || plan.phases.length < 3) return false;

    for (const phase of plan.phases) {
      if (!phase.name || !Array.isArray(phase.subtasks)) return false;
      for (const subtask of phase.subtasks) {
        if (!subtask.id || !subtask.description) return false;
      }
    }
    return true;
  }
}
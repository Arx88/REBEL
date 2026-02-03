import { BaseCLIAgent } from './BaseCLIAgent';
import { MASTER_PLANNER_PROMPT } from '../prompts';
import { Plan } from '../../../shared/types';
import { normalizePlan, validatePlanStrict } from '../core/PlanQuality';

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

    if (parsedPlan) {
      const { plan: normalizedPlan, fixes } = normalizePlan(parsedPlan, userInput);
      const validation = validatePlanStrict(normalizedPlan);

      if (validation.valid) {
        this.saveToMemory(taskId, 'final_plan', normalizedPlan);
        if (fixes.length > 0) {
          this.saveToMemory(taskId, 'plan_normalization_fixes', fixes);
        }
        return { success: true, plan: normalizedPlan, rawResponse: result.data, iterations: 1, executionTime: Date.now() - startTime };
      }
    }

    return { success: false, rawResponse: result.data, iterations: 1, executionTime: Date.now() - startTime };
  }
}

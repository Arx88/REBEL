import { BaseCLIAgent } from './BaseCLIAgent';
import { PLAN_VALIDATOR_PROMPT } from '../prompts';
import { Plan } from '../../../shared/types';

export interface ValidationResult {
  approved: boolean;
  confidence: number;
  criticalIssues: string[];
  missingContext: string[];
  reasoning: string;
  rawResponse: string;
  executionTime: number;
}

export class PlanValidator extends BaseCLIAgent {
  constructor(agentPool: any, memoryManager: any, db: any) {
    super(agentPool, memoryManager, db, { agentType: 'plan_validator', model: 'qwen' });
  }

  async execute(taskId: number, plan: Plan | string, userInput: string, projectContext: string = ''): Promise<ValidationResult> {
    console.log(`[PlanValidator] Validando plan`);
    const startTime = Date.now();

    const planString = typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2);
    const prompt = PLAN_VALIDATOR_PROMPT(planString, userInput);

    const result = await this.executePrompt(taskId, 'plan_validation', prompt, undefined, 'Validación de plan');

    if (!result.success) {
      return { approved: false, confidence: 0, criticalIssues: [result.data], missingContext: [], reasoning: 'Error', rawResponse: result.data, executionTime: result.executionTime };
    }

    const parsed = this.extractJSON<any>(result.data);

    if (parsed) {
      const approved = parsed.verdict === 'APPROVED' && (parsed.confidence_score || 0) >= 70;
      return {
        approved,
        confidence: parsed.confidence_score || 50,
        criticalIssues: parsed.critical_issues || [],
        missingContext: parsed.missing_context || [],
        reasoning: parsed.reasoning || '',
        rawResponse: result.data,
        executionTime: Date.now() - startTime
      };
    }

    return { approved: false, confidence: 40, criticalIssues: ['No parseable'], missingContext: [], reasoning: 'Error de parseo', rawResponse: result.data, executionTime: Date.now() - startTime };
  }
}
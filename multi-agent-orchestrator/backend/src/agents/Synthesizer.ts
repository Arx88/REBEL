import { BaseCLIAgent } from './BaseCLIAgent';
import { SYNTHESIZER_PROMPT } from '../prompts';

export class Synthesizer extends BaseCLIAgent {
  constructor(agentPool: any, memoryManager: any, db: any) {
    super(agentPool, memoryManager, db, { agentType: 'synthesizer', model: 'gemini' });
  }

  async generateFinalReport(taskId: number, originalTask: string, allExecutions: string, memorySummary: string): Promise<any> {
    console.log(`[Synthesizer] Generando reporte final`);

    const prompt = SYNTHESIZER_PROMPT(originalTask, allExecutions, memorySummary);
    const result = await this.executePrompt(taskId, 'final_synthesis', prompt, undefined, 'Reporte final');

    return {
      title: 'Reporte Final',
      completeReport: result.data,
      executiveSummary: result.data.substring(0, 500)
    };
  }
}
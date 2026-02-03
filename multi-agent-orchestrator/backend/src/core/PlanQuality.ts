import { Plan, Phase, SubTask } from '../../shared/types';

export interface PlanNormalizationResult {
  plan: Plan;
  fixes: string[];
  warnings: string[];
}

export interface PlanQualityScore {
  overall: number;
  completeness: number;
  riskManagement: number;
  clarity: number;
  details: string[];
}

const DEFAULT_CONTEXT_REQUIREMENTS = {
  files_to_analyze: [],
  documentation_to_read: [],
  existing_systems_to_understand: [],
  validation_criteria: []
};

const DEFAULT_PHASE_TEMPLATES = [
  { name: 'Preparación', why_necessary: 'Establece el contexto y alcance inicial.' },
  { name: 'Ejecución', why_necessary: 'Implementa los cambios principales.' },
  { name: 'Validación', why_necessary: 'Verifica resultados y calidad.' }
];

export function normalizePlan(input: Partial<Plan>, fallbackObjective: string): PlanNormalizationResult {
  const fixes: string[] = [];
  const warnings: string[] = [];

  const normalized: Plan = {
    objective: input.objective?.trim() || fallbackObjective.trim() || 'Definir objetivo pendiente.',
    context_requirements: {
      ...DEFAULT_CONTEXT_REQUIREMENTS,
      ...input.context_requirements,
      files_to_analyze: Array.isArray(input.context_requirements?.files_to_analyze)
        ? input.context_requirements.files_to_analyze
        : [],
      documentation_to_read: Array.isArray(input.context_requirements?.documentation_to_read)
        ? input.context_requirements.documentation_to_read
        : [],
      existing_systems_to_understand: Array.isArray(input.context_requirements?.existing_systems_to_understand)
        ? input.context_requirements.existing_systems_to_understand
        : [],
      validation_criteria: Array.isArray(input.context_requirements?.validation_criteria)
        ? input.context_requirements.validation_criteria
        : []
    },
    phases: [],
    success_criteria: Array.isArray(input.success_criteria) ? input.success_criteria : [],
    failure_prevention: Array.isArray(input.failure_prevention) ? input.failure_prevention : []
  };

  if (!input.objective?.trim()) {
    fixes.push('Objective missing: applied fallback objective.');
  }

  const inputPhases = Array.isArray(input.phases) ? input.phases : [];
  if (inputPhases.length === 0) {
    warnings.push('Phases missing: created default phases.');
  }

  const phaseTemplates = inputPhases.length >= 3
    ? inputPhases
    : [...inputPhases, ...DEFAULT_PHASE_TEMPLATES.slice(inputPhases.length)];

  normalized.phases = phaseTemplates.map((phase, index) => normalizePhase(phase, index, fixes));

  const subtaskIds = new Set<string>();
  normalized.phases.forEach((phase, phaseIndex) => {
    if (phase.subtasks.length === 0) {
      const defaultId = `${phaseIndex + 1}.1`;
      phase.subtasks.push(buildDefaultSubtask(defaultId, phaseIndex));
      fixes.push(`Phase ${phaseIndex + 1} had no subtasks: added default subtask ${defaultId}.`);
    }

    phase.subtasks = phase.subtasks.map((subtask, subtaskIndex) => {
      const suggestedId = `${phaseIndex + 1}.${subtaskIndex + 1}`;
      const normalizedSubtask = normalizeSubtask(subtask, suggestedId, fixes);

      if (subtaskIds.has(normalizedSubtask.id)) {
        const newId = `${phaseIndex + 1}.${subtaskIndex + 1}`;
        fixes.push(`Duplicate subtask id ${normalizedSubtask.id}: reassigned to ${newId}.`);
        normalizedSubtask.id = newId;
      }
      subtaskIds.add(normalizedSubtask.id);
      return normalizedSubtask;
    });
  });

  const knownIds = new Set<string>();
  normalized.phases.forEach(phase => phase.subtasks.forEach(subtask => knownIds.add(subtask.id)));

  normalized.phases.forEach((phase, phaseIndex) => {
    phase.subtasks.forEach((subtask, subtaskIndex) => {
      const filteredDeps = subtask.dependencies.filter(dep => dep !== subtask.id && knownIds.has(dep));
      if (filteredDeps.length !== subtask.dependencies.length) {
        fixes.push(`Subtask ${subtask.id} had invalid dependencies: filtered to [${filteredDeps.join(', ')}].`);
      }
      subtask.dependencies = filteredDeps;

      if (!subtask.validation_method?.trim()) {
        subtask.validation_method = `Validar completitud de ${subtask.description}`;
        fixes.push(`Subtask ${subtask.id} missing validation_method: added default.`);
      }

      if (!subtask.deliverable?.trim()) {
        subtask.deliverable = `Deliverable para ${subtask.description}`;
        fixes.push(`Subtask ${subtask.id} missing deliverable: added default.`);
      }
    });

    if (!Array.isArray(phase.validation_checkpoints)) {
      phase.validation_checkpoints = [];
      fixes.push(`Phase ${phaseIndex + 1} missing validation_checkpoints: set empty array.`);
    }
    if (!Array.isArray(phase.failure_points)) {
      phase.failure_points = [];
      fixes.push(`Phase ${phaseIndex + 1} missing failure_points: set empty array.`);
    }
  });

  if (normalized.success_criteria.length === 0) {
    warnings.push('Success criteria missing: consider adding measurable outcomes.');
  }

  if (normalized.failure_prevention.length === 0) {
    warnings.push('Failure prevention missing: consider adding risk mitigations.');
  }

  return { plan: normalized, fixes, warnings };
}

export function validatePlanStrict(plan: Plan): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!plan.objective?.trim()) {
    issues.push('Objective is required.');
  }

  if (!Array.isArray(plan.phases) || plan.phases.length < 1) {
    issues.push('At least one phase is required.');
  }

  plan.phases.forEach((phase, phaseIndex) => {
    if (!phase.name?.trim()) {
      issues.push(`Phase ${phaseIndex + 1} is missing a name.`);
    }
    if (!phase.why_necessary?.trim()) {
      issues.push(`Phase ${phaseIndex + 1} is missing why_necessary.`);
    }
    if (!Array.isArray(phase.subtasks) || phase.subtasks.length === 0) {
      issues.push(`Phase ${phaseIndex + 1} requires at least one subtask.`);
      return;
    }

    phase.subtasks.forEach((subtask, subtaskIndex) => {
      if (!subtask.id?.trim()) {
        issues.push(`Phase ${phaseIndex + 1} subtask ${subtaskIndex + 1} missing id.`);
      }
      if (!subtask.description?.trim()) {
        issues.push(`Subtask ${subtask.id || `${phaseIndex + 1}.${subtaskIndex + 1}`} missing description.`);
      }
      if (!subtask.deliverable?.trim()) {
        issues.push(`Subtask ${subtask.id} missing deliverable.`);
      }
      if (!subtask.validation_method?.trim()) {
        issues.push(`Subtask ${subtask.id} missing validation_method.`);
      }
      if (typeof subtask.estimated_complexity !== 'number' || subtask.estimated_complexity < 1 || subtask.estimated_complexity > 10) {
        issues.push(`Subtask ${subtask.id} estimated_complexity must be 1-10.`);
      }
      if (!Array.isArray(subtask.dependencies)) {
        issues.push(`Subtask ${subtask.id} dependencies must be an array.`);
      }
    });
  });

  return { valid: issues.length === 0, issues };
}

export function scorePlanQuality(plan: Plan): PlanQualityScore {
  const details: string[] = [];
  const totalSubtasks = plan.phases.reduce((sum, phase) => sum + phase.subtasks.length, 0);

  let completeness = 0;
  completeness += plan.objective?.trim() ? 2 : 0;
  completeness += plan.phases.length >= 3 ? 2 : plan.phases.length >= 1 ? 1 : 0;
  completeness += totalSubtasks >= 3 ? 2 : totalSubtasks >= 1 ? 1 : 0;
  completeness += plan.success_criteria.length > 0 ? 2 : 0;
  completeness += plan.context_requirements.validation_criteria.length > 0 ? 2 : 0;

  if (plan.success_criteria.length === 0) details.push('Faltan criterios de éxito medibles.');
  if (plan.context_requirements.validation_criteria.length === 0) details.push('Faltan criterios de validación en el contexto.');

  let riskManagement = 0;
  const phasesWithFailurePoints = plan.phases.filter(phase => phase.failure_points?.length > 0).length;
  const phasesWithCheckpoints = plan.phases.filter(phase => phase.validation_checkpoints?.length > 0).length;
  riskManagement += plan.failure_prevention.length > 0 ? 3 : 0;
  riskManagement += Math.min(phasesWithFailurePoints, 3) * 1.5;
  riskManagement += Math.min(phasesWithCheckpoints, 3) * 1.5;

  if (plan.failure_prevention.length === 0) details.push('No hay estrategias de prevención de fallos.');

  let clarity = 0;
  const avgDescLength = totalSubtasks
    ? plan.phases.reduce((sum, phase) => sum + phase.subtasks.reduce((subSum, subtask) => subSum + subtask.description.length, 0), 0) / totalSubtasks
    : 0;
  const avgDeliverableLength = totalSubtasks
    ? plan.phases.reduce((sum, phase) => sum + phase.subtasks.reduce((subSum, subtask) => subSum + subtask.deliverable.length, 0), 0) / totalSubtasks
    : 0;
  const avgValidationLength = totalSubtasks
    ? plan.phases.reduce((sum, phase) => sum + phase.subtasks.reduce((subSum, subtask) => subSum + subtask.validation_method.length, 0), 0) / totalSubtasks
    : 0;

  clarity += avgDescLength >= 30 ? 3 : avgDescLength >= 15 ? 2 : avgDescLength > 0 ? 1 : 0;
  clarity += avgDeliverableLength >= 20 ? 3 : avgDeliverableLength >= 10 ? 2 : avgDeliverableLength > 0 ? 1 : 0;
  clarity += avgValidationLength >= 20 ? 4 : avgValidationLength >= 10 ? 3 : avgValidationLength > 0 ? 1 : 0;

  if (avgDescLength < 15) details.push('Las descripciones de subtareas son cortas o vagas.');
  if (avgValidationLength < 10) details.push('Los métodos de validación necesitan más detalle.');

  const normalizedCompleteness = clampScore(completeness);
  const normalizedRisk = clampScore(riskManagement);
  const normalizedClarity = clampScore(clarity);

  const overall = roundScore((normalizedCompleteness + normalizedRisk + normalizedClarity) / 3);

  return {
    overall,
    completeness: normalizedCompleteness,
    riskManagement: normalizedRisk,
    clarity: normalizedClarity,
    details
  };
}

export function normalizeSubtask(input: Partial<SubTask>, suggestedId: string, fixes: string[] = []): SubTask {
  const id = input.id?.trim() || suggestedId;
  if (!input.id?.trim()) {
    fixes.push(`Subtask missing id: assigned ${id}.`);
  }

  const assignedAgent = input.assigned_agent_type === 'researcher' || input.assigned_agent_type === 'implementer'
    || input.assigned_agent_type === 'analyzer'
    ? input.assigned_agent_type
    : 'analyzer';

  if (input.assigned_agent_type !== assignedAgent) {
    fixes.push(`Subtask ${id} had invalid assigned_agent_type: set to ${assignedAgent}.`);
  }

  const estimatedComplexity = typeof input.estimated_complexity === 'number'
    ? clampNumber(input.estimated_complexity, 1, 10)
    : 3;

  if (input.estimated_complexity !== estimatedComplexity) {
    fixes.push(`Subtask ${id} estimated_complexity adjusted to ${estimatedComplexity}.`);
  }

  return {
    id,
    description: input.description?.trim() || `Definir paso ${id}`,
    assigned_agent_type: assignedAgent,
    required_context: Array.isArray(input.required_context) ? input.required_context : [],
    files_to_read: Array.isArray(input.files_to_read) ? input.files_to_read : [],
    deliverable: input.deliverable?.trim() || `Deliverable para ${input.description?.trim() || `paso ${id}`}`,
    validation_method: input.validation_method?.trim() || `Validar completitud del paso ${id}`,
    estimated_complexity: estimatedComplexity,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : []
  };
}

function normalizePhase(input: Partial<Phase>, index: number, fixes: string[]): Phase {
  const name = input.name?.trim() || DEFAULT_PHASE_TEMPLATES[index]?.name || `Fase ${index + 1}`;
  const whyNecessary = input.why_necessary?.trim()
    || DEFAULT_PHASE_TEMPLATES[index]?.why_necessary
    || 'Necesaria para completar el objetivo.';

  if (!input.name?.trim()) {
    fixes.push(`Phase ${index + 1} missing name: assigned ${name}.`);
  }
  if (!input.why_necessary?.trim()) {
    fixes.push(`Phase ${index + 1} missing why_necessary: added default.`);
  }

  return {
    name,
    why_necessary: whyNecessary,
    subtasks: Array.isArray(input.subtasks) ? input.subtasks.map(subtask => ({ ...subtask })) : [],
    validation_checkpoints: Array.isArray(input.validation_checkpoints) ? input.validation_checkpoints : [],
    failure_points: Array.isArray(input.failure_points) ? input.failure_points : []
  };
}

function buildDefaultSubtask(id: string, phaseIndex: number): SubTask {
  return {
    id,
    description: `Definir acciones para la fase ${phaseIndex + 1}.`,
    assigned_agent_type: 'analyzer',
    required_context: [],
    files_to_read: [],
    deliverable: `Resumen de acciones para la fase ${phaseIndex + 1}.`,
    validation_method: 'Confirmar que el resumen cubre los pasos necesarios.',
    estimated_complexity: 3,
    dependencies: []
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampScore(value: number): number {
  return roundScore(clampNumber(value, 0, 10));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface SimulationScenario {
  name: string;
  description: string;
  integration: string;
  endpoint: string;
  payload: Record<string, unknown>;
  isError: boolean;
}

export interface SimulationResult {
  scenario: string;
  success: boolean;
  response?: unknown;
  error?: string;
}

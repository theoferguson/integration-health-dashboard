import {
  procoreScenarios,
  gustoScenarios,
  quickbooksScenarios,
  stripeScenarios,
  certifiedPayrollScenarios,
} from './scenarios/index.js';
import type { SimulationScenario, SimulationResult } from './types.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

const allScenarios: SimulationScenario[] = [
  ...procoreScenarios,
  ...gustoScenarios,
  ...quickbooksScenarios,
  ...stripeScenarios,
  ...certifiedPayrollScenarios,
];

async function runScenario(scenario: SimulationScenario): Promise<SimulationResult> {
  try {
    const response = await fetch(`${API_URL}${scenario.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(scenario.payload),
    });

    const data = await response.json();

    return {
      scenario: scenario.name,
      success: true,
      response: data,
    };
  } catch (error) {
    return {
      scenario: scenario.name,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDemoMode(): Promise<void> {
  console.log('🎬 Running demo simulation...\n');
  console.log('This will populate the dashboard with realistic integration events.\n');

  // First, run a mix of successful events to establish baseline health
  const successScenarios = allScenarios.filter((s) => !s.isError);
  const errorScenarios = allScenarios.filter((s) => s.isError);

  // Run 20 random successful events
  console.log('📊 Seeding successful events...');
  for (let i = 0; i < 20; i++) {
    const scenario = successScenarios[Math.floor(Math.random() * successScenarios.length)];
    await runScenario(scenario);
    process.stdout.write('.');
    await sleep(50);
  }
  console.log(' Done!\n');

  // Run 5-8 error events to create interesting triage scenarios
  console.log('⚠️  Seeding error events for AI triage...');
  const errorCount = 5 + Math.floor(Math.random() * 4);
  const selectedErrors = errorScenarios
    .sort(() => Math.random() - 0.5)
    .slice(0, errorCount);

  for (const scenario of selectedErrors) {
    const result = await runScenario(scenario);
    console.log(`   ${result.success ? '✓' : '✗'} ${scenario.name}`);
    await sleep(100);
  }

  console.log('\n✅ Demo data seeded successfully!');
  console.log(`   ${20} successful events`);
  console.log(`   ${errorCount} error events ready for AI classification`);
  console.log('\n   Open the dashboard to see integration health and triage errors.');
}

async function runAllScenarios(): Promise<void> {
  console.log('🚀 Running all scenarios...\n');

  const results: SimulationResult[] = [];

  for (const scenario of allScenarios) {
    const result = await runScenario(scenario);
    results.push(result);

    const icon = scenario.isError ? '⚠️' : '✓';
    const status = result.success ? 'sent' : 'failed';
    console.log(`${icon} [${status}] ${scenario.name}`);

    await sleep(100); // Small delay between requests
  }

  console.log('\n📊 Summary:');
  console.log(`   Total scenarios: ${results.length}`);
  console.log(`   Successful sends: ${results.filter((r) => r.success).length}`);
  console.log(`   Failed sends: ${results.filter((r) => !r.success).length}`);
  console.log(`   Error simulations: ${allScenarios.filter((s) => s.isError).length}`);
}

async function runByIntegration(integration: string): Promise<void> {
  const scenarios = allScenarios.filter(
    (s) => s.integration.toLowerCase() === integration.toLowerCase()
  );

  if (scenarios.length === 0) {
    console.log(`No scenarios found for integration: ${integration}`);
    console.log('Available integrations: procore, gusto, quickbooks, stripe_issuing, certified_payroll');
    return;
  }

  console.log(`🚀 Running ${scenarios.length} scenarios for ${integration}...\n`);

  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    const icon = scenario.isError ? '⚠️' : '✓';
    const status = result.success ? 'sent' : 'failed';
    console.log(`${icon} [${status}] ${scenario.name}`);
    await sleep(100);
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--demo')) {
  runDemoMode();
} else if (args.includes('--integration')) {
  const integrationIndex = args.indexOf('--integration');
  const integration = args[integrationIndex + 1];
  if (integration) {
    runByIntegration(integration);
  } else {
    console.log('Please specify an integration: --integration <name>');
  }
} else if (args.includes('--help')) {
  console.log(`
Integration Health Dashboard - Simulator

Usage:
  npm run simulate              Run all scenarios once
  npm run simulate -- --demo    Run demo mode (seeds realistic data)
  npm run simulate -- --integration <name>
                                Run scenarios for specific integration

Integrations:
  procore, gusto, quickbooks, stripe_issuing, certified_payroll

Environment:
  API_URL    Base URL for the API (default: http://localhost:3001)
`);
} else {
  runAllScenarios();
}

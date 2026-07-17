/**
 * Usage: npm run create-project -- --name "integrations-host-app"
 * Prints the project id and API key. The key is only ever shown here -
 * it's not retrievable later, so save it now.
 */
import { createProject } from '../services/projectStore.js';

const nameFlagIndex = process.argv.indexOf('--name');
const name = nameFlagIndex !== -1 ? process.argv[nameFlagIndex + 1] : undefined;

if (!name) {
  console.error('Usage: npm run create-project -- --name "some-project-name"');
  process.exit(1);
}

const project = createProject(name);

console.log(`Project created:`);
console.log(`  id:      ${project.id}`);
console.log(`  name:    ${project.name}`);
console.log(`  api key: ${project.apiKey}`);
console.log(`\nSave the api key now - use it as the Bearer token for POST /api/ingest.`);

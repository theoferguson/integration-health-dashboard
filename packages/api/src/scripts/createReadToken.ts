/**
 * Usage: npm run create-read-token -- --org <orgId> --name "my-agent"
 * Mints a read token for the /api/v1 surface. The secret is only ever shown
 * here - save it now.
 *
 * Run without --org to list available orgs (id - name) and exit.
 */
import '../loadEnv.js';
import { db } from '../db/connection.js';
import { createReadToken } from '../services/readTokenStore.js';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const orgId = flag('--org');
const name = flag('--name');

const orgs = db.prepare('SELECT id, name FROM orgs ORDER BY created_at ASC').all() as {
  id: string;
  name: string;
}[];

if (!orgId || !name) {
  console.error('Usage: npm run create-read-token -- --org <orgId> --name "some-name"\n');
  if (orgs.length) {
    console.error('Available orgs:');
    for (const o of orgs) console.error(`  ${o.id}  ${o.name}`);
  } else {
    console.error('No orgs exist yet - sign in via the web app to create one.');
  }
  process.exit(1);
}

if (!orgs.some((o) => o.id === orgId)) {
  console.error(`No org with id ${orgId}. Run without --org to list valid ids.`);
  process.exit(1);
}

const { token, secret } = createReadToken(orgId, name);

console.log('Read token created:');
console.log(`  id:     ${token.id}`);
console.log(`  name:   ${token.name}`);
console.log(`  org:    ${token.orgId}`);
console.log(`  secret: ${secret}`);
console.log('\nSave the secret now - send it as `Authorization: Bearer <secret>` to /api/v1. It is not retrievable later.');

/**
 * Loads .env from the monorepo root, anchored to this module's own file
 * location via import.meta.url rather than process.cwd() (which differs
 * depending on how the process is launched - npm run vs npx tsx directly).
 *
 * Must be the first import in any real entrypoint (index.ts, scripts/*.ts) -
 * other modules (e.g. db/connection.ts) read process.env at module load
 * time. Tests deliberately don't import this - they shouldn't depend on a
 * developer's local secrets.
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });

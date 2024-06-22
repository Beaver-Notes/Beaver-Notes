import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Resolve current directory path
const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadEnv(env) {
  dotenv.config({ path: `${__dirname}/.env.${env}` });
}

// Load .env.development file
loadEnv('development');

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Resolve current directory path
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.development file
dotenv.config({ path: `${__dirname}/.env.development` });

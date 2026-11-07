// Local file transformation only. No n8n API calls, activation or database access.
import fs from 'node:fs';
import { patchBuyCourse } from './lib/buy-course-workflow-patch.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/prepare-buy-course-access-patch.mjs <protected-current-workflow.json> <new-protected-api-body.json>');
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const source = raw.data || raw;
if (source.reviewOnly) throw new Error('Redacted review JSON cannot generate a production API body');
const w = patchBuyCourse(source);
const body = { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} };
fs.writeFileSync(output, JSON.stringify(body, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Prepared protected workflow API body. Nothing published.');

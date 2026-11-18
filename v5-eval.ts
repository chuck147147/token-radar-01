import { readFileSync } from 'node:fs';
import { evaluateCandidates, evaluateExploration, parseSnapshot } from './lib/model.ts';

const snapshot = parseSnapshot(readFileSync(new URL('../token-radar-01-kit/input/snapshot.json', import.meta.url), 'utf8'));
console.log(JSON.stringify({ evaluateCandidates: evaluateCandidates(snapshot), evaluateExploration: evaluateExploration(snapshot) }, null, 2));

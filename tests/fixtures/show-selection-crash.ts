import { writeFileSync } from 'node:fs';
import { activateStagedShow, type ShowSelection, type StagedRestore } from '../../src/main/show-selection';

const [directory, marker, phase, candidateJson, selectionJson] = process.argv.slice(2);
const block = () => { writeFileSync(marker, 'ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000); };
void activateStagedShow(directory, JSON.parse(candidateJson) as StagedRestore, JSON.parse(selectionJson) as ShowSelection,
  phase === 'before' ? { beforeCommit: block } : { afterCommit: block }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });

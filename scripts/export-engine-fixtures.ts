/** Export the existing fictional fixture inputs, never generated solver outputs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { seed } from '../src/lib/seed';
await mkdir('backend/fixtures',{recursive:true});
const fixtures = Object.fromEntries((['normal','high-demand','shortage'] as const).map(s=>[s,seed(s)]));
await writeFile('backend/fixtures/workspaces.json',JSON.stringify(fixtures,null,2)+'\n');
console.log('Exported three fictional workspace inputs. No optimization was run.');

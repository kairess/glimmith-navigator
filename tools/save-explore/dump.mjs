import * as fs from 'fs';
import { parseGvas } from './gvas.mjs';

const buf = fs.readFileSync('C:/Users/kaire/AppData/Local/Geri/Saved/SaveGames/SaveFile1.sav');
const result = parseGvas(buf);
console.log('header:', JSON.stringify(result.header, null, 2));
console.log('bytesConsumed:', result.bytesConsumed, '/', result.totalBytes);
console.log('top-level property names:', Object.keys(result.properties));
console.log('warnings count:', result.warnings.length);
for (const w of result.warnings.slice(0, 30)) console.log('WARN:', w);

fs.writeFileSync('out.json', JSON.stringify(result, (k, v) => {
  if (Buffer.isBuffer(v)) return v.toString('hex');
  return v;
}, 2));
console.log('wrote out.json, size=', fs.statSync('out.json').size);

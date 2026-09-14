import * as fs from 'fs';
import { Gvas, Serializer } from 'uesavetool';

const buf = fs.readFileSync('C:/Users/kaire/AppData/Local/Geri/Saved/SaveGames/SaveFile1.sav');
const gvas = new Gvas();
const serial = new Serializer(buf);
try {
  gvas.deserialize(serial);
  fs.writeFileSync('out.json', JSON.stringify(gvas, null, 2));
  console.log('OK, wrote out.json, size=', fs.statSync('out.json').size);
} catch (e) {
  console.error('FAILED at offset', serial.tell !== undefined ? serial.tell : '?');
  console.error(e);
}

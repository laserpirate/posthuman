// 4-up contact sheet of the draft kodamas for review: local/kodamas/contact-sheet.jpg (never committed)
//   node tools/kodama-contact.mjs [pk26,pk27,pk28,pk29]   (needs node serve.mjs --port 8091)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = (process.argv[2] || 'pk26,pk27,pk28,pk29').split(',');
const b = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1300, height: 740 } });
await p.goto('http://localhost:8091/tools/kodama-harness.html');
await p.evaluate(() => KH.open());
const shots = [];
for (const id of ids) {
  await p.evaluate(id => KH.load(id), id);
  await p.evaluate(() => KH.run(6000));
  shots.push(await p.evaluate(() => KH.thumb(960, 540)));
}
const sheet = await p.evaluate(async ([shots, ids]) => {
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const g = c.getContext('2d');
  for (let i = 0; i < shots.length; i++) {
    const img = new Image(); img.src = shots[i]; await img.decode();
    g.drawImage(img, (i % 2) * 960, Math.floor(i / 2) * 540);
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect((i % 2) * 960, Math.floor(i / 2) * 540, 230, 34);
    g.fillStyle = '#c4f53c'; g.font = '600 18px monospace'; g.fillText(ids[i] + ' · draft', (i % 2) * 960 + 12, Math.floor(i / 2) * 540 + 23);
  }
  return c.toDataURL('image/jpeg', 0.86);
}, [shots, ids]);
fs.writeFileSync(path.join(ROOT, 'local', 'kodamas', 'contact-sheet.jpg'), Buffer.from(sheet.split(',')[1], 'base64'));
console.log('local/kodamas/contact-sheet.jpg');
await b.close();

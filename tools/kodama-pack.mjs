// Builds the encrypted kodama pack that GitHub Pages carries: kodamas/pack.json (how to derive the key)
// and kodamas/NN.bin (each a 12-byte IV followed by AES-256-GCM ciphertext). Source: the plain pack in
// local/kodamas/. The password is in local/kodama-pass.txt (gitignored; made on the first run). The salt
// stays the same across rebuilds, so a laptop that remembered the key keeps working.
//   node tools/kodama-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'local', 'kodamas');
const OUT = path.join(ROOT, 'kodamas');
const PASSFILE = path.join(ROOT, 'local', 'kodama-pass.txt');
const ITER = 250000;

const WORDS = ('moss tide lantern cedar heron reed delta fern ember monsoon lotus mangrove orchid pine canopy ' +
  'basalt cenote koi willow river cloud moon spire salt amber cobalt jade dusk dawn rain kelp coral ' +
  'tern ibis ash birch harbor isle loam mesa ridge glade grove marsh wren lichen nectar pollen quartz').split(' ');
function makePass() {
  const r = crypto.getRandomValues(new Uint32Array(5));
  return [0, 1, 2, 3].map(i => WORDS[r[i] % WORDS.length]).join('-') + '-' + String(r[4] % 10000).padStart(4, '0');
}
const b64 = u8 => Buffer.from(u8).toString('base64');

if (!fs.existsSync(PASSFILE)) { fs.writeFileSync(PASSFILE, makePass() + '\n'); console.log('new password written to local/kodama-pass.txt'); }
const pass = fs.readFileSync(PASSFILE, 'utf8').trim();
const prev = fs.existsSync(path.join(OUT, 'pack.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'pack.json'), 'utf8')) : null;
const salt = prev && prev.salt ? Buffer.from(prev.salt, 'base64') : crypto.getRandomValues(new Uint8Array(16));

const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
async function seal(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.bin')) fs.unlinkSync(path.join(OUT, f));
let n = 0;
const put = async bytes => { const name = String(n++).padStart(3, '0') + '.bin'; fs.writeFileSync(path.join(OUT, name), await seal(bytes)); return name; };

const idx = JSON.parse(fs.readFileSync(path.join(SRC, 'index.json'), 'utf8'));
const files = {}, thumbs = {};
for (const s of idx.scenes) {
  files[s.file] = await put(fs.readFileSync(path.join(SRC, s.file)));
  if (s.thumb && fs.existsSync(path.join(SRC, s.thumb))) thumbs[s.id] = await put(fs.readFileSync(path.join(SRC, s.thumb)));
}
const manifest = await put(fs.readFileSync(path.join(SRC, 'phylla-kodama-manifest.js')));
const index = await put(Buffer.from(JSON.stringify({ ...idx, files, thumbs, manifest })));
fs.writeFileSync(path.join(OUT, 'pack.json'), JSON.stringify({ format: 'posthuman-kodama-enc', version: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), cipher: 'AES-256-GCM', index }, null, 1) + '\n');
console.log('kodamas/: ' + n + ' encrypted files, ' + idx.scenes.length + ' scenes');

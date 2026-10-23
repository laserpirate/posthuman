// Builds data/sketches.js from the Hydra gallery (src/stores/examples.json in hydra-synth/hydra).
//   node tools/build-data.mjs <path/to/examples.json>
// Code is decoded exactly (base64, then URI decode) and kept verbatim, author header included.
// Title, author and link come from each sketch's header comment; META below records the reading
// of every header so odd ones ("//CNDSD", "// e_e // @eerie_ear") resolve the same way each build.
// Quarantine flags come from data/quarantine.json, written by tools/preflight.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-data.mjs <examples.json>'); process.exit(1); }

// id: [title, author, link]. Read from the header comment of each sketch.
const META = {
  example_0: ['Untitled', 'Flor de Fuego', ''],
  example_3: ['Untitled', 'Olivia Jack', ''],
  example_4: ['Untitled', 'Nelson Vera', 'twitter: @nel_sonologia'],
  example_6: ['Untitled', 'Débora Falleiros Gonzales', 'https://www.gonzalesdebora.com/'],
  example_8: ['Untitled', 'Rodrigo Velasco', 'https://yecto.github.io/'],
  example_9: ['Untitled', 'Rodrigo Velasco', 'https://yecto.github.io/'],
  example_10: ['Untitled', 'Zach Krall', 'http://zachkrall.online/'],
  example_11: ['Untitled', 'Zach Krall', 'http://zachkrall.online/'],
  example_13: ['acid bus seat', 'Will Humphreys', 'https://github.com/TheWispy'],
  example_14: ['Untitled', 'Olivia Jack', '@_ojack_'],
  example_15: ['Untitled', 'Olivia Jack', 'https://ojack.github.io'],
  example_16: ['Untitled', 'Olivia Jack', 'https://ojack.github.io'],
  example_17: ['moire', 'Olivia Jack', 'twitter: @_ojack_'],
  example_18: ['Untitled', 'Olivia Jack', 'https://ojack.github.io'],
  rangga_0: ['Dreamy Diamond', 'Rangga Purnama Aji', 'https://ranggapurnamaaji1.wixsite.com/portfolio'],
  rangga_1: ['Tag & Sweep', 'Rangga Purnama Aji', 'https://ranggapurnamaaji1.wixsite.com/portfolio'],
  rangga_2: ['Monochrome Memoar', 'Rangga Purnama Aji', 'https://ranggapurnamaaji1.wixsite.com/portfolio'],
  rangga_3: ['Galaxy Trip', 'Rangga Purnama Aji', 'https://ranggapurnamaaji1.wixsite.com/portfolio'],
  rangga_4: ['Sumet', 'Rangga Purnama Aji', 'https://ranggapurnamaaji1.wixsite.com/portfolio'],
  marianne_0: ['port', 'Marianne Teixido', 'https://marianneteixido.github.io/'],
  marianne_1: ['Pixelscape', 'Marianne Teixido', 'https://github.com/MarianneTeixido'],
  naoto_0: ['Untitled', 'Naoto Hieda', '@naoto_hieda'],
  naoto_1: ['Untitled', 'Naoto Hieda', '@naoto_hieda'],
  ritchse_0: ['random trypophobia', 'Ritchse', 'instagram.com/ritchse'],
  ritchse_1: ['corrupted screensaver', 'Ritchse', 'instagram.com/ritchse'],
  ritchse_2: ['tropical juice', 'Ritchse', 'instagram.com/ritchse'],
  ritchse_3: ['trying to get closer', 'Ritchse', 'instagram.com/ritchse'],
  ritchse_4: ['disintegration', 'Ritchse', 'instagram.com/ritchse'],
  flor_0: ['Untitled', 'Flor de Fuego', 'https://flordefuego.github.io/'],
  mahalia_0: ['Untitled', 'Mahalia H-R', 'IG: @mm_hr_'],
  mahalia_1: ['Untitled', 'Mahalia H-R', 'IG: @mm_hr_'],
  mahalia_2: ['Velvet Pool', 'Mahalia H-R', 'IG: mm_hr_'],
  mahalia_3: ['Untitled', 'Mahalia H-R', 'IG: mm_hr_'],
  mahalia_4: ['Cellular & Blobular', 'Mahalia H-R', 'IG: mm_hr_'],
  andromeda_0: ['3.0', 'ΔNDR0M3DΔ', 'https://www.instagram.com/androm3_da/'],
  andromeda_1: ['3.3', 'ΔNDR0M3DΔ', 'https://www.instagram.com/androm3_da/'],
  asdrubal_0: ['Untitled', 'Asdrúbal Gomez', ''],
  flor_1: ['Hydra Glitchy Slit Scan', 'Flor de Fuego', 'https://flordefuego.github.io/'],
  flor_2: ['Glitch River', 'Flor de Fuego', 'https://flordefuego.github.io/'],
  nesso_0: ['clouds of passage', 'Nesso', 'www.nesso.xyz'],
  malitzin_0: ['sand spirals', 'CNDSD', 'http://malitzincortes.net/'],
  malitzin_1: ['ameba', 'CNDSD', 'http://malitzincortes.net/'],
  malitzin_2: ['crazy squares', 'CNDSD', 'http://malitzincortes.net/'],
  khoparzi_0: ['Happy Mandala', 'Abhinay Khoparzi', 'twitter/github/instagram: @khoparzi'],
  khoparzi_1: ['Perpetual elevator buttons', 'Khoparzi', 'http://khoparzi.com'],
  khoparzi_2: ['Really Love', 'Abhinay Khoparzi', 'http://khoparzi.com'],
  khoparzi_3: ['Aqautic blubs', 'Khoparzi', 'https://khoparzi.com'],
  celeste_0: ['Puertas II', 'Celeste Betancur', 'https://github.com/essteban'],
  celeste_1: ['Puertas III', 'Celeste Betancur', 'https://github.com/essteban'],
  celeste_2: ['Puertas', 'Celeste Betancur', 'https://github.com/essteban'],
  alexandre_0: ['the-wall', 'Alexandre Rangel', 'www.alexandrerangel.art.br/hydra.html'],
  alexandre_1: ['eye of the beholder', 'Alexandre Rangel', 'www.alexandrerangel.art.br/hydra.html'],
  alexandre_2: ['egg of the phoenix', 'Alexandre Rangel', 'www.alexandrerangel.art.br/hydra.html'],
  afalfl_0: ['filet mignon', 'AFALFL', 'instagram/a_f_alfl'],
  eerie_ear_0: ['ee_2 . MULTIVERSE . time and feedback', 'e_e', '@eerie_ear'],
  eerie_ear_1: ['ee_3 //LINES', 'e_e', '@eerie_ear'],
  eerie_ear_2: ['ee_5 . FUGITIVE GEOMETRY VHS', 'e_e', '@eerie_ear'],
  eerie_ear_3: ['ee_1 . EYE IN THE SKY', 'e_e', '@eerie_ear'],
};

// the 7 favorites: starred and loaded as the starting playlist
const FAVORITES = ['celeste_1', 'ritchse_1', 'nesso_0', 'marianne_0', 'andromeda_1', 'ritchse_4', 'rangga_4'];

// a link field becomes an href only when it reads as a web address
function href(link) {
  if (/^https?:\/\//.test(link)) return link;
  if (/^(www\.|instagram\.com|[\w-]+\.(xyz|com|net|io|art\.br))/.test(link)) return 'https://' + link;
  return '';
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let quarantine = {};
const qPath = path.join(ROOT, 'data', 'quarantine.json');
if (fs.existsSync(qPath)) quarantine = JSON.parse(fs.readFileSync(qPath, 'utf8')).sketches || {};

const sketches = raw.map(e => {
  const code = decodeURIComponent(Buffer.from(e.code, 'base64').toString('utf8'));
  const m = META[e.sketch_id];
  if (!m) throw new Error('no header reading for ' + e.sketch_id);
  const [title, author, link] = m;
  return {
    id: e.sketch_id, title, author, link, href: href(link), code,
    hydraCode: e.code, // the gallery's own encoding, reused for the Edit in Hydra link
    thumb: 'thumbs/' + e.sketch_id + '.jpg',
    quarantine: quarantine[e.sketch_id] || '',
  };
});
for (const id of Object.keys(META)) if (!sketches.find(s => s.id === id)) throw new Error('missing sketch ' + id);
for (const id of FAVORITES) if (!sketches.find(s => s.id === id)) throw new Error('missing favorite ' + id);

const out = '// Generated by tools/build-data.mjs. Do not edit.\n' +
  '// Sketches: Hydra gallery (github.com/hydra-synth/hydra, src/stores/examples.json), each by the\n' +
  '// artist in its header, CC BY-NC-SA 4.0. Code decoded verbatim.\n' +
  'window.PH_DATA = ' + JSON.stringify({ license: 'CC BY-NC-SA 4.0', favorites: FAVORITES, sketches }, null, 1) + ';\n';
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'sketches.js'), out);
console.log('wrote data/sketches.js:', sketches.length, 'sketches,', sketches.filter(s => s.quarantine).length, 'quarantined');

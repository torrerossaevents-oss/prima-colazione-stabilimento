/**
 * Copies the on-device label reader files (tesseract.js worker, LSTM wasm cores, Italian model)
 * from node_modules into public/ocr, so the iPad loads them from our own protected domain and no
 * label photo or text ever leaves the device. Generated at dev/build time; not versioned.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz', 'ita.traineddata.gz'],
];
export function copyOcrAssets() {
  const target = join(root, 'public', 'ocr');
  mkdirSync(target, { recursive: true });
  for (const [from, to] of files) {
    const source = join(root, from); const dest = join(target, to);
    if (!existsSync(source)) throw new Error(`File del lettore etichette mancante: ${from}. Esegui npm ci.`);
    if (!existsSync(dest) || statSync(dest).size !== statSync(source).size) copyFileSync(source, dest);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { copyOcrAssets(); console.log('Lettore etichette copiato in public/ocr'); }

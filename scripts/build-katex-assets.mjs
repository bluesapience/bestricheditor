// Copies KaTeX CSS + woff2 fonts to dist/ (dist/katex.css, dist/fonts/*.woff2).
// Only woff2 is shipped (all evergreen browsers); woff/ttf fallbacks are stripped from the CSS.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const katexDist = join(dirname(require.resolve('katex/package.json')), 'dist');
mkdirSync('dist/fonts', { recursive: true });

let css = readFileSync(join(katexDist, 'katex.min.css'), 'utf8');
css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '');
writeFileSync('dist/katex.css', css);

let n = 0;
for (const f of readdirSync(join(katexDist, 'fonts'))) {
  if (f.endsWith('.woff2')) { copyFileSync(join(katexDist, 'fonts', f), join('dist/fonts', f)); n++; }
}
console.log(`katex.css + ${n} fonts -> dist/`);

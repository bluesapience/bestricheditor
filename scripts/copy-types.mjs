// Emits types/index.d.cts from types/index.d.ts so `require()` consumers under TypeScript's
// node16/nodenext resolution get a CommonJS-flavoured declaration file (a lone .d.ts next to
// "type": "module" is treated as ESM and errors with "masquerading as ESM").
import { copyFileSync } from 'node:fs';
copyFileSync('types/index.d.ts', 'types/index.d.cts');
console.log('types/index.d.cts written');

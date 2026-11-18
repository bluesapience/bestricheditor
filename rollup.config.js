import { resolve } from 'path';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';

const isProd = process.env.BUILD === 'production';

/**
 * katex-lazy.js carries two marker-delimited variants. Keep the ESM one
 * (`import('katex')`) or the UMD one (script loader), strip the other.
 */
function katexVariant(kind) {
  return {
    name: 'bre-katex-variant',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('src/utils/katex-lazy.js')) return null;
      const strip = (c, name) => c.replace(new RegExp(`/\\* @bre-${name}-start[\\s\\S]*?@bre-${name}-end \\*/`, 'g'), '');
      let out = code;
      if (kind === 'umd') {
        out = out.replace(/\/\* @bre-esm-start \*\/[\s\S]*?\/\* @bre-esm-end \*\//g, '');
        out = out.replace(/\/\* @bre-umd-start\n?/g, '').replace(/\n?@bre-umd-end \*\//g, '');
      } else {
        out = strip(out, 'umd');
      }
      return { code: out, map: null };
    },
  };
}

const minify = () => terser({ ecma: 2020, compress: { passes: 2 }, format: { comments: false } });
const externalEsm = ['dompurify', 'katex'];

const prodConfigs = [
  // ESM: dompurify + katex external (resolved by the consumer's bundler)
  {
    input: 'src/bre.js',
    external: (id) => externalEsm.some((m) => id === m || id.startsWith(m + '/')),
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: 'bre.esm.js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      sourcemap: true,
    },
    plugins: [
      katexVariant('esm'),
      nodeResolve(),
      postcss({ extract: resolve('dist/bre.css'), minimize: true }),
      minify(),
    ],
  },
  // UMD core: bundles DOMPurify, loads KaTeX lazily from bre.katex.umd.js
  {
    input: 'src/bre.js',
    output: [
      { file: 'dist/bre.umd.js', format: 'umd', name: 'bre', exports: 'named', inlineDynamicImports: true, sourcemap: true },
      // package.json has "type":"module", so Node would parse a .js UMD as ESM.
      // Same bundle with a .cjs extension is what require() must load.
      { file: 'dist/bre.umd.cjs', format: 'umd', name: 'bre', exports: 'named', inlineDynamicImports: true },
    ],
    plugins: [
      katexVariant('umd'),
      nodeResolve(),
      postcss({ inject: true, minimize: true }),
      minify(),
    ],
  },
  // KaTeX for the UMD/CDN build
  {
    input: 'scripts/katex-entry.js',
    output: { file: 'dist/bre.katex.umd.js', format: 'iife', sourcemap: true },
    plugins: [nodeResolve(), minify()],
  },
];

let config;

if (!isProd) {
  // Dev: single ESM build, CSS injected at runtime, dev server + livereload.
  // Imports inside the if-block so serve() isn't called at load time in production.
  const { default: serve } = await import('rollup-plugin-serve');
  const { default: livereload } = await import('rollup-plugin-livereload');

  config = {
    input: 'src/bre.js',
    output: { file: 'dist/bre.esm.js', format: 'esm', sourcemap: true, inlineDynamicImports: true },
    plugins: [
      katexVariant('esm'),
      nodeResolve(),
      postcss({ inject: true }),
      serve({ contentBase: ['.'], port: 3000, open: true, openPage: '/demo/index.html' }),
      livereload({ watch: ['dist', 'demo'] }),
    ],
  };
} else {
  config = prodConfigs;
}

export default config;

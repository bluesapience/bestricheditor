import { resolve } from 'path';
import nodeResolve from '@rollup/plugin-node-resolve';
import postcss from 'rollup-plugin-postcss';

const isProd = process.env.BUILD === 'production';

// Prod: ESM (code-split, KaTeX in its own chunk) + UMD (all-in-one)
const prodConfigs = [
  {
    input: 'src/bre.js',
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: 'bre.esm.js',
      chunkFileNames: 'chunks/[name]-[hash].js',
    },
    plugins: [
      nodeResolve(),
      postcss({ extract: resolve('dist/bre.css'), minimize: true }),
    ],
  },
  {
    input: 'src/bre.js',
    // UMD inlines dynamic imports so everything stays in one file.
    output: { file: 'dist/bre.umd.js', format: 'umd', name: 'bre', exports: 'named', inlineDynamicImports: true },
    plugins: [
      nodeResolve(),
      postcss({ inject: true, minimize: true }),
    ],
  },
];

let config;

if (!isProd) {
  // Dev: single ESM build, CSS injected at runtime, dev server + livereload
  // These imports are inside the if-block to avoid serve() being called at
  // module load time in production, which would call process.exit() if
  // port 3000 is already in use.
  const { default: serve } = await import('rollup-plugin-serve');
  const { default: livereload } = await import('rollup-plugin-livereload');

  config = {
    input: 'src/bre.js',
    output: { file: 'dist/bre.esm.js', format: 'esm', sourcemap: true },
    plugins: [
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

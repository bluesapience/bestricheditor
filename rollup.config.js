import { resolve } from 'path';
import nodeResolve from '@rollup/plugin-node-resolve';
import postcss from 'rollup-plugin-postcss';
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';

const isProd = process.env.BUILD === 'production';

// Dev: single ESM build, CSS injected at runtime, dev server + livereload
const devConfig = {
  input: 'src/bre.js',
  output: { file: 'dist/bre.esm.js', format: 'esm', sourcemap: true },
  plugins: [
    nodeResolve(),
    postcss({ inject: true }),
    serve({ contentBase: ['.'], port: 3000, open: true, openPage: '/demo/index.html' }),
    livereload({ watch: ['dist', 'demo'] }),
  ],
};

// Prod: ESM (with extracted CSS) + UMD (self-contained, CSS injected)
const prodConfigs = [
  {
    input: 'src/bre.js',
    output: { file: 'dist/bre.esm.js', format: 'esm' },
    plugins: [
      nodeResolve(),
      postcss({ extract: resolve('dist/bre.css'), minimize: true }),
    ],
  },
  {
    input: 'src/bre.js',
    output: { file: 'dist/bre.umd.js', format: 'umd', name: 'bre', exports: 'named' },
    plugins: [
      nodeResolve(),
      postcss({ inject: true, minimize: true }),
    ],
  },
];

export default isProd ? prodConfigs : devConfig;

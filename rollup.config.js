import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';

const dev = Boolean(process.env.ROLLUP_WATCH);

const card = {
  input: 'src/tankrupt-cr-card.ts',
  output: {
    file: 'dist/tankrupt-cr-card.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: dev,
  },
  plugins: [
    nodeResolve({ browser: true }),
    commonjs(),
    esbuild({ target: 'es2021', minify: false, tsconfig: './tsconfig.json' }),
    !dev && terser(),
  ].filter(Boolean),
  onwarn(warning, warn) {
    if (warning.code === 'THIS_IS_UNDEFINED' && /[/\\]node_modules[/\\]/.test(warning.id ?? '')) {
      return;
    }
    warn(warning);
  },
};

export default [
  card,
  {
    input: 'demo/entry.ts',
    external: ['./tankrupt-cr-card.js'],
    output: { file: 'dist/demo.js', format: 'es', sourcemap: dev },
    plugins: [
      nodeResolve({ browser: true }),
      commonjs(),
      esbuild({ target: 'es2021', tsconfig: './tsconfig.json' }),
      dev &&
        serve({
          contentBase: ['demo', 'dist'],
          host: '127.0.0.1',
          port: 5000,
        }),
      !dev && terser(),
    ].filter(Boolean),
    onwarn: card.onwarn,
  },
];

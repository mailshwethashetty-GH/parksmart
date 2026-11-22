// Bundle the API (and the workspace TS packages it imports) into dist/server.js.
// npm dependencies stay external and are installed in the runtime image.
import { build } from 'esbuild';
import { cpSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@parksmart/'));
// Runtime deps of the bundled workspace packages must also be listed in apps/api
// dependencies (pnpm is strict, so the bundle can only resolve the API's own deps).

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  external,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
// Migrations are read from disk at startup (packages/db resolves ../migrations from the bundle).
cpSync('../../packages/db/migrations', 'migrations', { recursive: true });
console.log('Built dist/server.js');

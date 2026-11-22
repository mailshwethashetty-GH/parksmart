// Build ParkSmart for Vercel with the Build Output API (ADR-016):
//   .vercel/output/static/          the web app (Vite build)
//   .vercel/output/functions/api.func/  the whole API bundled into one Node function
//   .vercel/output/config.json      routes: /api/* and /health → function, else the SPA
// Run by Vercel (vercel.json buildCommand) or locally: `node scripts/vercel-build.mjs`.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.vercel/output');
const fromWeb = createRequire(resolve(root, 'apps/web/package.json'));
const fromApi = createRequire(resolve(root, 'apps/api/package.json'));

rmSync(out, { recursive: true, force: true });

// 1. Web app (static, served from Vercel's CDN).
const vite = await import(fromWeb.resolve('vite'));
await vite.build({ root: resolve(root, 'apps/web'), logLevel: 'warn' });
cpSync(resolve(root, 'apps/web/dist'), resolve(out, 'static'), { recursive: true });

// 2. API function: everything bundled, so no node_modules ship with it. The libSQL
//    HTTP client replaces the native one (Turso only; there is no disk on Vercel).
const fn = resolve(out, 'functions/api.func');
mkdirSync(fn, { recursive: true });
const esbuild = await import(fromApi.resolve('esbuild'));
const result = await esbuild.build({
  entryPoints: [resolve(root, 'apps/api/src/vercel.ts')],
  absWorkingDir: resolve(root, 'apps/api'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(fn, 'index.mjs'),
  alias: { '@libsql/client': '@libsql/client/web' },
  // Dev-only logger transport; never loaded in production.
  external: ['pino-pretty'],
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __fu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join(' '),
  },
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
writeFileSync(
  resolve(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 60,
    },
    null,
    2,
  ),
);

// 3. Routing and headers. Static assets get the same security headers Fastify sets.
const securityHeaders = {
  'content-security-policy':
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';" +
    "frame-ancestors 'self';img-src 'self' data: blob:;object-src 'none';script-src 'self';" +
    "script-src-attr 'none';style-src 'self' https: 'unsafe-inline';connect-src 'self';" +
    "worker-src 'self';manifest-src 'self';upgrade-insecure-requests",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
};
writeFileSync(
  resolve(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api' },
        { src: '^/health$', dest: '/api' },
        {
          src: '^/assets/(.*)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        {
          src: '^/(sw\\.js|registerSW\\.js|manifest\\.webmanifest)$',
          headers: { 'cache-control': 'no-cache' },
          continue: true,
        },
        { src: '^/(.*)$', headers: securityHeaders, continue: true },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
      // Backstop only: Vercel's free plan runs crons once a day. GitHub Actions calls
      // /api/v1/cron/tick every 5 minutes (.github/workflows/tick.yml).
      crons: [{ path: '/api/v1/cron/tick', schedule: '30 0 * * *' }],
    },
    null,
    2,
  ),
);
console.log(`Built .vercel/output (API function ${(bytes / 1024 / 1024).toFixed(1)} MB)`);

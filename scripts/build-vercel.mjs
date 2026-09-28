// Assembles a Vercel Build Output API (v3) directory:
//   .vercel/output/static            ← the built web app (apps/web/dist)
//   .vercel/output/functions/api.func ← the Fastify API bundled into one file
// Vercel deploys .vercel/output as-is, so this is the whole deployment.
// Docs: https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = `${root}.vercel/output`
const funcDir = `${out}/functions/api.func`

await rm(out, { recursive: true, force: true })
await mkdir(funcDir, { recursive: true })

await cp(`${root}apps/web/dist`, `${out}/static`, { recursive: true })

await build({
  entryPoints: [`${root}apps/api/src/vercel.ts`],
  outfile: `${funcDir}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
})

await writeFile(
  `${funcDir}/.vc-config.json`,
  JSON.stringify(
    // lhr1 (London): UK data residency, and next to the Supabase database (eu-west-2).
    { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', regions: ['lhr1'] },
    null,
    2,
  ),
)

await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(.*)', headers: { 'X-Robots-Tag': 'noindex', 'X-Simulation': 'true' }, continue: true },
        { src: '/api/(.*)', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)

console.log(`Vercel build output written to ${out}`)

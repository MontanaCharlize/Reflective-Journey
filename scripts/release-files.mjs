import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const SOURCE_ROOTS = ['src', 'server', 'scripts', 'tests', 'evals', 'public', 'docs', 'deploy', 'legacy-v0.5.3', '.github', '.gitattributes', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'vite.config.mjs', 'index.html', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml', 'README.md', '启动项目.bat']
const RUNTIME_ROOTS = ['server', 'dist', 'scripts/start-local.mjs', 'scripts/runtime-help.mjs', 'scripts/database-backup.mjs', 'scripts/database-restore.mjs', 'scripts/healthcheck.mjs', 'package.json', '.env.example', 'README.md', '启动项目.bat', 'docs/LOCAL-RELEASE.md', 'docs/SUBMISSION-INTRO.md']
const privateDirs = new Set(['.qa', '.backups', '.artifacts', '.git', '.claude', '.workbuddy', '.playwright-cli', 'node_modules', 'data', 'before-restore'])
function privateFile(relative) {
  const name = path.basename(relative)
  return (name.startsWith('.env') && name !== '.env.example' && name !== '.env.production.example') || /\.(?:sqlite|db)(?:[.-].*)?$|\.(?:pem|key|log|tsbuildinfo)$|\.server\.lock$/i.test(name)
}
export async function releaseFiles(root, kind = 'source') {
  if (!['source', 'runtime'].includes(kind)) throw new Error('Unknown release kind')
  root = path.resolve(root)
  const result = []
  async function walk(relative) {
    const parts = relative.split(/[\\/]/)
    if (parts.some((part) => privateDirs.has(part)) || privateFile(relative)) return
    const absolute = path.resolve(root, relative)
    if (!absolute.startsWith(root + path.sep)) throw new Error('Release path escaped project')
    const stat = await fs.lstat(absolute).catch((error) => { if (error.code === 'ENOENT') return null;throw error })
    if (!stat) return
    if (stat.isSymbolicLink()) throw new Error('Release input must not contain symbolic links: ' + relative)
    if (stat.isDirectory()) for (const name of await fs.readdir(absolute)) await walk(path.join(relative, name))
    else if (stat.isFile()) result.push(relative.split(path.sep).join('/'))
  }
  for (const item of kind === 'source' ? SOURCE_ROOTS : RUNTIME_ROOTS) await walk(item)
  return [...new Set(result)].sort()
}
export async function stageRelease(root, destination, kind) {
  root = path.resolve(root);destination = path.resolve(destination)
  try { await fs.access(destination);throw new Error('Release staging destination already exists') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const files = await releaseFiles(root, kind)
  for (const required of ['package.json', 'server/serve.mjs', 'server/dialogue-turn.mjs', 'server/community-features.mjs']) if (!files.includes(required)) throw new Error('Release is missing ' + required)
  if (kind === 'source' && !files.includes('evals/cognitive-cases.json')) throw new Error('Test fixtures missing from source release')
  if (kind === 'runtime' && !files.includes('dist/index.html')) throw new Error('Build the application first')
  for (const relative of files) {
    const target = path.join(destination, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(root, relative), target)
  }
  const sourcePackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  if (kind === 'runtime') {
    const runtimePackage = {
      name: 'reflective-journey-runtime', private: true, version: sourcePackage.version,
      type: 'module', engines: sourcePackage.engines,
      reflectiveJourney: { distribution: 'runtime' },
      scripts: {
        start: 'node scripts/start-local.mjs', dev: 'node scripts/start-local.mjs',
        serve: 'node scripts/start-local.mjs', preview: 'node scripts/start-local.mjs',
        test: 'node scripts/runtime-help.mjs test', build: 'node scripts/runtime-help.mjs build',
        backup: 'node scripts/database-backup.mjs', restore: 'node scripts/database-restore.mjs',
      },
    }
    await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n')
    await fs.writeFile(path.join(destination, 'package-lock.json'), JSON.stringify({
      name: runtimePackage.name, version: runtimePackage.version, lockfileVersion: 3, requires: true,
      packages: { '': { name: runtimePackage.name, version: runtimePackage.version, engines: runtimePackage.engines } },
    }, null, 2) + '\n')
    await fs.copyFile(path.join(root, 'docs/RUNTIME-README.md'), path.join(destination, 'README.md'))
    files.push('package-lock.json')
  }
  const manifest = []
  for (const relative of [...new Set(files)].sort()) manifest.push({ path: relative, sha256: createHash('sha256').update(await fs.readFile(path.join(destination, relative))).digest('hex') })
  await fs.writeFile(path.join(destination, 'FILE-MANIFEST.json'), JSON.stringify({ version: sourcePackage.version, kind, files: manifest }, null, 2))
  return { destination, kind, files: manifest.length }
}

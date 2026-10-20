import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { releaseFiles, stageRelease } from '../scripts/release-files.mjs'
const execute = promisify(execFile)
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-release-'))
  t.after(async () => { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid test path');await fs.rm(root, { recursive: true, force: true }) })
  const add = async (name) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });await fs.writeFile(path.join(root, name), 'fixture') }
  for (const name of ['src/App.tsx', 'evals/cognitive-cases.json', '.env.example', '.env.local', '.qa/private-replay.json', '.backups/old-secret.txt', 'data/community.sqlite', 'public/accidental.sqlite', 'public/.env.local', 'server/application.mjs', 'server/community-features.mjs', 'server/serve.mjs', 'server/dialogue-turn.mjs', 'dist/index.html', 'node_modules/package/index.js', 'README.md', '.github/workflows/ci.yml', '.gitattributes', 'CHANGELOG.md']) await add(name)
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'source-app', version: '0.9.1', type: 'module', engines: { node: '>=24.13' }, scripts: { test: 'node --test tests/*.test.mjs', dev: 'vite' }, dependencies: { vite: '*' } }))
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(root, 'docs'), { recursive: true })
  await fs.copyFile(new URL('../scripts/runtime-help.mjs', import.meta.url), path.join(root, 'scripts/runtime-help.mjs'))
  await fs.copyFile(new URL('../docs/RUNTIME-README.md', import.meta.url), path.join(root, 'docs/RUNTIME-README.md'))
  return root
}
test('源码清单保留测试样例，同时排除密钥、私人回放、数据库和依赖目录', async (t) => {
  const files = await releaseFiles(await fixture(t), 'source')
  assert.ok(files.includes('evals/cognitive-cases.json'));assert.ok(files.includes('.env.example'));assert.ok(files.includes('src/App.tsx'))
  assert.ok(files.includes('.github/workflows/ci.yml'));assert.ok(files.includes('.gitattributes'));assert.ok(files.includes('CHANGELOG.md'))
  assert.doesNotMatch(files.join('\n'), /\.env\.local|\.qa\/|\.backups\/|node_modules\/|\.sqlite|^dist\//m)
})
test('运行清单包含构建与服务端，不带源码测试或本机秘密', async (t) => {
  const files = await releaseFiles(await fixture(t), 'runtime')
  assert.ok(files.includes('dist/index.html'));assert.ok(files.includes('server/community-features.mjs'))
  assert.doesNotMatch(files.join('\n'), /src\/|tests\/|evals\/|\.env\.local|\.sqlite/)
})

test('生成的运行包只保留运行命令，测试和构建明确失败而非零项通过', async (t) => {
  const root = await fixture(t), destination = path.join(root, 'output')
  await stageRelease(root, destination, 'runtime')
  const metadata = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'))
  assert.equal(metadata.reflectiveJourney.distribution, 'runtime')
  assert.equal(metadata.dependencies, undefined);assert.equal(metadata.devDependencies, undefined)
  for (const name of ['start', 'dev', 'serve', 'preview']) assert.equal(metadata.scripts[name], 'node scripts/start-local.mjs')
  for (const name of ['test', 'build']) {
    const result = await execute(process.execPath, ['scripts/runtime-help.mjs', name], { cwd: destination }).then(() => null, (error) => error)
    assert.equal(result?.code, 1);assert.match(result.stderr, /源码包/);assert.doesNotMatch(result.stdout, /tests 0|pass 0/)
  }
  const readme = await fs.readFile(path.join(destination, 'README.md'), 'utf8')
  assert.match(readme, /不需要安装依赖或重新构建/)
})

test('运行包清单校验的是生成后的独立配置和无依赖锁文件', async (t) => {
  const root = await fixture(t), destination = path.join(root, 'output')
  await stageRelease(root, destination, 'runtime')
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'FILE-MANIFEST.json'), 'utf8'))
  assert.ok(manifest.files.some((item) => item.path === 'package-lock.json'))
  for (const item of manifest.files) assert.equal(createHash('sha256').update(await fs.readFile(path.join(destination, item.path))).digest('hex'), item.sha256)
  const lock = JSON.parse(await fs.readFile(path.join(destination, 'package-lock.json'), 'utf8'))
  assert.deepEqual(Object.keys(lock.packages), ['']);assert.equal(lock.name, 'reflective-journey-runtime')
})

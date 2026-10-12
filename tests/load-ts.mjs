import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modules = new Map()
function moduleUrl(relative) {
  const absolute = path.join(root, relative)
  if (modules.has(absolute)) return modules.get(absolute)
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, _quote, name) => {
    const dependency = path.relative(root, path.resolve(path.dirname(absolute), name + '.ts'))
    return 'from ' + JSON.stringify(moduleUrl(dependency))
  })
  const url = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  modules.set(absolute, url)
  return url
}
export const loadTs = (relative) => import(moduleUrl(relative))

export function memoryStorage() {
  const data = new Map()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) }
}

import { readFile } from 'node:fs/promises'
import { transformAsync } from '@babel/core'

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.jsx')) {
    const source = await readFile(new URL(url), 'utf8')
    const result = await transformAsync(source, {
      filename: url,
      sourceMaps: 'inline',
      babelrc: false,
      configFile: false,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
        ['@babel/preset-react', { runtime: 'automatic' }]
      ]
    })
    return {
      format: 'module',
      source: result.code,
      shortCircuit: true
    }
  }
  return defaultLoad(url, context, defaultLoad)
}

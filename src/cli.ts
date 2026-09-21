#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { generate } from './generate.ts'
import type { GeneratorConfig } from './config.ts'

const USAGE = `Usage: prisma-dto-gen --schema <path> --out <path> [options]

  --schema <path>   Prisma schema to read
  --out <path>      TypeScript file to write
  --config <path>   Config module (.js, .mjs) with a default export, or .json
  --check           Do not write. Exit 1 when the file on disk is not what the schema produces.
  --help            Show this message
`

async function loadConfig(file: string): Promise<GeneratorConfig> {
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) throw new Error(`config not found: ${file}`)
  if (resolved.endsWith('.json')) return JSON.parse(fs.readFileSync(resolved, 'utf8')) as GeneratorConfig
  const module = (await import(pathToFileURL(resolved).href)) as { default?: GeneratorConfig }
  if (!module.default) throw new Error(`config has no default export: ${file}`)
  return module.default
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      schema: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })

  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (!values.schema || !values.out) {
    process.stderr.write(USAGE)
    return 1
  }

  const schemaPath = path.resolve(values.schema)
  if (!fs.existsSync(schemaPath)) {
    process.stderr.write(`schema not found: ${values.schema}\n`)
    return 1
  }

  const config = values.config ? await loadConfig(values.config) : {}
  // The header carries the path exactly as it was passed in. Deriving it from cwd would make the output
  // depend on where the command ran from, and --check would then fail in CI for no reason.
  const generated = generate(fs.readFileSync(schemaPath, 'utf8'), {
    sourceName: values.schema,
    config,
  })

  const outPath = path.resolve(values.out)
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null

  if (values.check) {
    if (current === generated) {
      process.stdout.write(`${values.out} is up to date\n`)
      return 0
    }
    process.stderr.write(`${values.out} is stale, run prisma-dto-gen without --check\n`)
    return 1
  }

  if (current === generated) {
    process.stdout.write(`${values.out} is up to date\n`)
    return 0
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, generated, 'utf8')
  process.stdout.write(`${current === null ? 'created' : 'updated'} ${values.out}\n`)
  return 0
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  },
)

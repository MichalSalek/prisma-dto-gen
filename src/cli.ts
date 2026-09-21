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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A config is hand written, so a typo in it must fail loudly. Without this a JSON file holding `null` or a
 * number where a type name belongs would generate default output, or types like `id: 42`, and exit 0.
 */
function checkConfig(value: unknown, file: string): GeneratorConfig {
  const fail = (message: string): never => { throw new Error(`${file}: ${message}`) }
  if (!isPlainObject(value)) return fail('config must be an object')

  for (const key of ['typeMap', 'modelNames'] as const) {
    const table = value[key]
    if (table === undefined) continue
    if (!isPlainObject(table)) fail(`${key} must be an object`)
    for (const [name, mapped] of Object.entries(table as Record<string, unknown>)) {
      if (typeof mapped !== 'string') fail(`${key}.${name} must be a string`)
    }
  }

  if (value.fieldTypes !== undefined) {
    if (!isPlainObject(value.fieldTypes)) fail('fieldTypes must be an object')
    for (const [model, fields] of Object.entries(value.fieldTypes as Record<string, unknown>)) {
      if (!isPlainObject(fields)) fail(`fieldTypes.${model} must be an object`)
      for (const [field, mapped] of Object.entries(fields as Record<string, unknown>)) {
        if (typeof mapped !== 'string') fail(`fieldTypes.${model}.${field} must be a string`)
      }
    }
  }

  for (const key of ['skipEnums', 'header'] as const) {
    const list = value[key]
    if (list === undefined) continue
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) fail(`${key} must be an array of strings`)
  }

  if (value.imports !== undefined) {
    if (!Array.isArray(value.imports)) fail('imports must be an array')
    for (const [index, spec] of (value.imports as unknown[]).entries()) {
      if (!isPlainObject(spec)) fail(`imports[${index}] must be an object`)
      const { types, from } = spec as { types?: unknown; from?: unknown }
      if (!Array.isArray(types) || types.length === 0 || types.some((t) => typeof t !== 'string')) {
        fail(`imports[${index}].types must be a non-empty array of strings`)
      }
      if (typeof from !== 'string' || from.length === 0) fail(`imports[${index}].from must be a string`)
    }
  }

  return value as GeneratorConfig
}

async function loadConfig(file: string): Promise<GeneratorConfig> {
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) throw new Error(`config not found: ${file}`)
  if (resolved.endsWith('.json')) return checkConfig(JSON.parse(fs.readFileSync(resolved, 'utf8')), file)
  const module = (await import(pathToFileURL(resolved).href)) as { default?: unknown }
  if (module.default === undefined) throw new Error(`${file}: config has no default export`)
  return checkConfig(module.default, file)
}

/** Written next to the target and renamed over it, so an interrupted run cannot leave a half written file. */
function writeAtomic(target: string, contents: string): void {
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.writeFileSync(temporary, contents, 'utf8')
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
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

  if (current === generated) {
    process.stdout.write(`${values.out} is up to date\n`)
    return 0
  }
  if (values.check) {
    process.stderr.write(`${values.out} is stale, run prisma-dto-gen without --check\n`)
    return 1
  }

  writeAtomic(outPath, generated)
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

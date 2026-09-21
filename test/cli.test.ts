import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '../src/cli.ts')
const schema = path.join(here, 'fixtures/blog.prisma')

let workdir = ''

interface Run {
  code: number
  stdout: string
  stderr: string
}

async function cliRun(...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], { cwd: workdir })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

before(() => { workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-dto-gen-')) })
after(() => { fs.rmSync(workdir, { recursive: true, force: true }) })

describe('cli', () => {
  it('creates the file, then reports it is up to date', async () => {
    const out = path.join(workdir, 'nested/db.generated.ts')

    const first = await cliRun('--schema', schema, '--out', out)
    assert.equal(first.code, 0)
    assert.match(first.stdout, /^created /)
    assert.match(fs.readFileSync(out, 'utf8'), /export type User = \{/)

    const second = await cliRun('--schema', schema, '--out', out)
    assert.equal(second.code, 0)
    assert.match(second.stdout, /is up to date/)
  })

  it('check passes on a fresh file and fails on a stale one without touching it', async () => {
    const out = path.join(workdir, 'check.ts')
    await cliRun('--schema', schema, '--out', out)

    const fresh = await cliRun('--schema', schema, '--out', out, '--check')
    assert.equal(fresh.code, 0)

    fs.writeFileSync(out, 'export type User = { id: number }\n', 'utf8')
    const stale = await cliRun('--schema', schema, '--out', out, '--check')
    assert.equal(stale.code, 1)
    assert.match(stale.stderr, /is stale/)
    assert.equal(fs.readFileSync(out, 'utf8'), 'export type User = { id: number }\n', '--check must not write')
  })

  it('reads a config module', async () => {
    const config = path.join(workdir, 'dto.config.mjs')
    fs.writeFileSync(config, 'export default {typeMap: {DateTime: "string"}, modelNames: {User: "UserRow"}}\n', 'utf8')
    const out = path.join(workdir, 'configured.ts')

    const result = await cliRun('--schema', schema, '--out', out, '--config', config)

    assert.equal(result.code, 0)
    const generated = fs.readFileSync(out, 'utf8')
    assert.match(generated, /export type UserRow = \{/)
    assert.match(generated, /created_at: string$/m)
  })

  it('puts the schema path in the header exactly as it was passed', async () => {
    // Deriving it from cwd instead would change the output when the command runs from a subdirectory, and
    // an absolute path would put someone's home directory into a committed file.
    const relative = path.relative(workdir, schema)
    const out = path.join(workdir, 'stable.ts')

    await cliRun('--schema', relative, '--out', out)

    const header = fs.readFileSync(out, 'utf8').split('\n')[0]
    assert.equal(header, `// Generated from ${relative} by prisma-dto-gen. Do not edit by hand.`)
  })

  it('fails on a missing schema', async () => {
    const result = await cliRun('--schema', path.join(workdir, 'nope.prisma'), '--out', path.join(workdir, 'x.ts'))
    assert.equal(result.code, 1)
    assert.match(result.stderr, /schema not found/)
  })

  it('prints usage without arguments', async () => {
    const result = await cliRun()
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Usage: prisma-dto-gen/)
  })
})

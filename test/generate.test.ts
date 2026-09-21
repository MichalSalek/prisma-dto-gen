import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DuplicateNameError, EmptySchemaError, generate } from '../src/generate.ts'
import type { GeneratorConfig } from '../src/config.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const blog = fs.readFileSync(path.join(here, 'fixtures/blog.prisma'), 'utf8')

function run(config?: GeneratorConfig): string {
  return generate(blog, { sourceName: 'blog.prisma', ...(config ? { config } : {}) })
}

describe('generate', () => {
  it('writes a header naming the source', () => {
    assert.match(run(), /^\/\/ Generated from blog\.prisma by prisma-dto-gen\. Do not edit by hand\./)
  })

  it('turns an enum into a frozen object and a union of its values', () => {
    assert.match(run(), /export const Role = Object\.freeze\(\{\n {2}ADMIN: 'ADMIN',\n {2}AUTHOR: 'AUTHOR',\n {2}READER: 'READER',\n\} as const\)/)
    assert.match(run(), /export type Role = \(typeof Role\)\[keyof typeof Role\]/)
  })

  it('maps scalars with the default map', () => {
    const out = run()
    assert.match(out, /id: string$/m)
    assert.match(out, /views: bigint$/m)
    assert.match(out, /balance: string$/m, 'Decimal defaults to string, a number would lose precision')
    assert.match(out, /created_at: Date$/m)
  })

  it('marks an optional column as nullable, not optional', () => {
    assert.match(run(), /nickname: string \| null$/m)
    // `unknown` already admits null, so a second null would only add noise.
    assert.match(run(), /settings: unknown$/m)
  })

  it('keeps list columns as arrays', () => {
    assert.match(run(), /labels: string\[\]$/m)
  })

  it('drops relation fields but keeps the foreign key', () => {
    const out = run()
    assert.doesNotMatch(out, /^ {2}author: /m, 'a relation is not a column')
    assert.doesNotMatch(out, /^ {2}posts: /m)
    assert.match(out, /author_id: string$/m)
  })

  it('uses an enum by name as a field type', () => {
    assert.match(run(), /role: Role$/m)
  })

  it('applies a type map override', () => {
    assert.match(run({ typeMap: { DateTime: 'string', Decimal: 'number' } }), /created_at: string$/m)
    assert.match(run({ typeMap: { DateTime: 'string', Decimal: 'number' } }), /balance: number$/m)
  })

  it('applies a per field override over everything else', () => {
    const out = run({ fieldTypes: { User: { settings: 'UserSettings' } } })
    assert.match(out, /settings: UserSettings \| null$/m)
  })

  it('keeps the array suffix on an overridden type', () => {
    const out = run({ fieldTypes: { User: { labels: 'LabelName' } } })
    assert.match(out, /labels: LabelName\[\]$/m, 'dropping [] here would compile and lie')
  })

  it('renames a model', () => {
    assert.match(run({ modelNames: { User: 'UserRow' } }), /export type UserRow = \{/)
  })

  it('leaves a skipped enum out of the output but still uses it as a field type', () => {
    const out = run({ skipEnums: ['Plan'] })
    assert.doesNotMatch(out, /export const Plan/)
    assert.match(out, /plan: Plan$/m)
  })

  it('writes the configured imports', () => {
    const out = run({ imports: [{ types: ['UserSettings', 'LabelName'], from: './domain.ts' }] })
    assert.match(out, /^import type \{ UserSettings, LabelName \} from '\.\/domain\.ts'$/m)
  })

  it('refuses a schema with no models instead of emitting an empty file', () => {
    assert.throws(() => generate('enum Role {\n  ADMIN\n}\n', { sourceName: 'broken.prisma' }), EmptySchemaError)
  })

  it('does not read a field override off Object.prototype', () => {
    const schema = 'model Thing {\n  id String @id\n  constructor String\n  toString String\n}\n'
    const out = generate(schema, { config: { fieldTypes: { Thing: {} } } })

    assert.match(out, /constructor: string$/m)
    assert.match(out, /toString: string$/m)
  })

  it('wraps a union override before adding the array suffix', () => {
    const out = run({ fieldTypes: { User: { labels: 'string | number' } } })
    assert.match(out, /labels: \(string \| number\)\[\]$/m, 'string | number[] would be a different type')
  })

  it('wraps a function override before adding null', () => {
    const out = run({ fieldTypes: { User: { nickname: '() => string' } } })
    assert.match(out, /nickname: \(\(\) => string\) \| null$/m, 'null must not land on the return type')
  })

  it('leaves a plain union unwrapped when adding null', () => {
    const out = run({ fieldTypes: { User: { nickname: "'a' | 'b'" } } })
    assert.match(out, /nickname: 'a' \| 'b' \| null$/m)
  })

  it('maps an unsupported database type to unknown instead of an object', () => {
    const schema = 'model Place {\n  id String @id\n  location Unsupported("point")?\n}\n'
    const out = generate(schema)

    assert.match(out, /location: unknown$/m)
    assert.doesNotMatch(out, /\[object Object\]/)
  })

  it('refuses a rename that collides with an enum', () => {
    assert.throws(() => run({ modelNames: { User: 'Role' } }), DuplicateNameError)
  })

  it('is stable: the same schema gives the same bytes', () => {
    assert.equal(run(), run())
  })
})

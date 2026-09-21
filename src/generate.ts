import { getSchema, type Enum, type Field, type Model, type Schema } from '@mrleebo/prisma-ast'
import { DEFAULT_TYPE_MAP, type GeneratorConfig } from './config.ts'

export class EmptySchemaError extends Error {
  constructor(source: string) {
    super(`parsed 0 models from ${source}: the schema is empty, truncated or not a Prisma schema`)
    this.name = 'EmptySchemaError'
  }
}

interface Context {
  config: GeneratorConfig
  typeMap: Record<string, string>
  modelNames: ReadonlySet<string>
}

function isField(property: { type: string }): property is Field {
  return property.type === 'field'
}

function scalarFields(model: Model, modelNames: ReadonlySet<string>): Field[] {
  // A field whose type is another model is a relation, not a column. Prisma keeps the foreign key in its own
  // scalar field, which is the one that survives here.
  return model.properties.filter(isField).filter((f) => !modelNames.has(String(f.fieldType)))
}

function fieldType(field: Field, modelName: string, context: Context): string {
  const declared = String(field.fieldType)
  const override = context.config.fieldTypes?.[modelName]?.[field.name]
  // An unmapped type is an enum the config skipped, or a type the project imports. Either way it is written
  // as declared. The array suffix has to be applied here too: without it a String[] column mapped to a named
  // type would generate a single value, which compiles and lies.
  const base = override ?? context.typeMap[declared] ?? declared
  return field.array ? `${base}[]` : base
}

function renderEnum(definition: Enum): string {
  const names = definition.enumerators.filter((e): e is { type: 'enumerator'; name: string } => e.type === 'enumerator')
  const entries = names.map((e) => `  ${e.name}: '${e.name}',`).join('\n')
  return [
    `export const ${definition.name} = Object.freeze({`,
    entries,
    '} as const)',
    `export type ${definition.name} = (typeof ${definition.name})[keyof typeof ${definition.name}]`,
  ].join('\n')
}

/** `unknown` and `any` already admit null, so adding it would only make the generated file noisier. */
const ABSORBS_NULL = new Set(['unknown', 'any'])

function renderModel(model: Model, context: Context): string {
  const name = context.config.modelNames?.[model.name] ?? model.name
  const lines = scalarFields(model, context.modelNames).map((field) => {
    const type = fieldType(field, model.name, context)
    // Prisma returns null for an optional column, never undefined, so the output says null.
    const nullable = field.optional && !ABSORBS_NULL.has(type) ? ' | null' : ''
    return `  ${field.name}: ${type}${nullable}`
  })
  return [`export type ${name} = {`, ...lines, '}'].join('\n')
}

function renderImports(config: GeneratorConfig): string[] {
  if (!config.imports?.length) return []
  return config.imports.map((spec) => `import type { ${spec.types.join(', ')} } from '${spec.from}'`)
}

export interface GenerateOptions {
  /** Written into the header so the generated file says where it came from. */
  sourceName?: string
  config?: GeneratorConfig
}

/** Turns a Prisma schema into TypeScript types. Throws EmptySchemaError rather than returning an empty file. */
export function generate(schemaSource: string, options: GenerateOptions = {}): string {
  const config = options.config ?? {}
  const sourceName = options.sourceName ?? 'the Prisma schema'
  const schema: Schema = getSchema(schemaSource)

  const models = schema.list.filter((block): block is Model => block.type === 'model')
  if (models.length === 0) throw new EmptySchemaError(sourceName)

  const skipped = new Set(config.skipEnums ?? [])
  const enums = schema.list.filter((block): block is Enum => block.type === 'enum').filter((e) => !skipped.has(e.name))

  const context: Context = {
    config,
    typeMap: { ...DEFAULT_TYPE_MAP, ...config.typeMap },
    modelNames: new Set(models.map((m) => m.name)),
  }

  const header = [
    `// Generated from ${sourceName} by prisma-dto-gen. Do not edit by hand.`,
    ...(config.header ?? []),
  ]

  const sections = [
    header.join('\n'),
    renderImports(config).join('\n'),
    enums.map(renderEnum).join('\n\n'),
    models.map((model) => renderModel(model, context)).join('\n\n'),
  ].filter((section) => section.length > 0)

  return `${sections.join('\n\n')}\n`
}

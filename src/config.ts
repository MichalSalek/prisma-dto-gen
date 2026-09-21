/** Prisma scalar to TypeScript type. Merged over the defaults, so you only list what you want changed. */
export type TypeMap = Record<string, string>

export interface ImportSpec {
  /** Type names to import. */
  types: string[]
  /** Module specifier, written into the generated file as is. */
  from: string
}

export interface GeneratorConfig {
  /** Overrides on top of DEFAULT_TYPE_MAP. */
  typeMap?: TypeMap
  /** Prisma model name to the name used in the output, when they differ. */
  modelNames?: Record<string, string>
  /** Enums defined elsewhere. They are left out of the output but still resolve as field types. */
  skipEnums?: string[]
  /** Per field override: {ModelName: {field_name: 'MyType'}}. Wins over everything else. */
  fieldTypes?: Record<string, Record<string, string>>
  /** Imports written at the top of the generated file. Needed by the types used in fieldTypes. */
  imports?: ImportSpec[]
  /** Extra lines appended to the generated header comment. */
  header?: string[]
}

/**
 * Deliberately conservative.
 *
 * Decimal becomes a string: Prisma returns a Decimal instance, and a number would silently lose precision on
 * the values people keep in a Decimal column in the first place. Json becomes unknown because a Json column
 * can hold an array or a scalar, not only an object. Both are the sort of thing you override once per project
 * when you know what is actually in there.
 */
export const DEFAULT_TYPE_MAP: TypeMap = {
  String: 'string',
  Boolean: 'boolean',
  Int: 'number',
  Float: 'number',
  BigInt: 'bigint',
  Decimal: 'string',
  DateTime: 'Date',
  Json: 'unknown',
  Bytes: 'Uint8Array',
}

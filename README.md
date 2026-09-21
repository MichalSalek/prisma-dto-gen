# prisma-dto-gen

> Generate plain TypeScript types from a Prisma schema

Reads a `schema.prisma` and writes one file of exported types and enums. No Prisma client, no branded types,
no runtime: the output is types you can import anywhere, including in a package that must not depend on
`@prisma/client`.

It is meant to be committed and checked in CI. `--check` regenerates in memory and fails when the file on disk
no longer matches the schema, which is how you find out that a migration landed and the types did not.

## Install

```sh
npm install --save-dev prisma-dto-gen
```

## Usage

```sh
npx prisma-dto-gen --schema prisma/schema.prisma --out src/db.generated.ts
```

For this schema:

```prisma
enum Role {
  ADMIN
  AUTHOR
  READER
}

model User {
  id         String   @id @default(uuid())
  email      String   @unique
  nickname   String?
  role       Role     @default(READER)
  labels     String[]
  created_at DateTime @default(now())
  posts      Post[]
}
```

you get:

```ts
// Generated from prisma/schema.prisma by prisma-dto-gen. Do not edit by hand.

export const Role = Object.freeze({
  ADMIN: 'ADMIN',
  AUTHOR: 'AUTHOR',
  READER: 'READER',
} as const)
export type Role = (typeof Role)[keyof typeof Role]

export type User = {
  id: string
  email: string
  nickname: string | null
  role: Role
  labels: string[]
  created_at: Date
}
```

An enum becomes a frozen object next to the union type, so the values exist at runtime as well. An optional
column becomes `| null`, because that is what Prisma returns. A relation field is dropped and its foreign key
scalar is kept, because the relation is not a column.

## Options

```
--schema <path>   Prisma schema to read
--out <path>      TypeScript file to write
--config <path>   Config module (.js, .mjs) with a default export, or .json
--check           Do not write. Exit 1 when the file on disk is not what the schema produces.
--help
```

Without `--check` the file is written only when the content changed, so a no-op run leaves the mtime alone.

### In CI

```json
{
  "scripts": {
    "db:types": "prisma-dto-gen --schema prisma/schema.prisma --out src/db.generated.ts",
    "db:types:check": "npm run db:types -- --check"
  }
}
```

## Type mapping

| Prisma | TypeScript |
| --- | --- |
| `String` | `string` |
| `Boolean` | `boolean` |
| `Int`, `Float` | `number` |
| `BigInt` | `bigint` |
| `Decimal` | `string` |
| `DateTime` | `Date` |
| `Json` | `unknown` |
| `Bytes` | `Uint8Array` |

Two of those are deliberate and both are overridable.

`Decimal` maps to `string`, not `number`. Prisma hands back a Decimal instance, and the values people keep in
a Decimal column are exactly the ones a float would round.

`Json` maps to `unknown`, not `Record<string, unknown>`. A Json column can hold an array, a number or null.
Once you know what is actually in a given column, name it with `fieldTypes`.

A type the generator does not recognise is written as declared, so an enum you excluded or a type your project
already owns keeps working as a field type. Add the matching import with `imports`.

## Config

```js
// dto.config.mjs
export default {
  typeMap: {DateTime: 'string'},
  modelNames: {User: 'UserRow'},
  skipEnums: ['Plan'],
  fieldTypes: {
    User: {settings: 'UserSettings'},
  },
  imports: [
    {types: ['UserSettings'], from: './domain/user.ts'},
  ],
  header: ['// Regenerate: npm run db:types'],
};
```

| Key | Effect |
| --- | --- |
| `typeMap` | Overrides merged over the defaults above |
| `modelNames` | Prisma model name to the name used in the output |
| `skipEnums` | Enums defined elsewhere. Left out of the file, still usable as field types |
| `fieldTypes` | Per field override, `{Model: {field: 'Type'}}`. Wins over everything else |
| `imports` | Type-only imports written at the top of the file |
| `header` | Extra lines appended to the generated header comment |

An override keeps the array suffix, so a `String[]` column mapped to `LabelName` becomes `LabelName[]`.

## API

```js
import {generate} from 'prisma-dto-gen';

const code = generate(schemaSource, {sourceName: 'schema.prisma', config});
```

Returns the file contents as a string. Throws `EmptySchemaError` when the schema parses but contains no
models, rather than returning an empty file: a truncated schema parses without an error, and writing that
result over a committed file loses the types and reports success.

## Scope

Columns and enums, nothing else. Relations, indexes, `@@map`, composite types and multi-file schemas are not
handled. If you need the full picture, use the Prisma client types.

## License

MIT

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is, type SQL } from "drizzle-orm";
import { getTableConfig, isPgEnum, PgDialect, PgTable } from "drizzle-orm/pg-core";
import * as querySchema from "../src/db/schema";
import { applyProductMigrations, readProductMigrations } from "./lib/product-migrations";

const REPO_ROOT = resolve(process.env.SCHEMA_CHECK_ROOT ?? process.cwd());
const ALLOWLIST_PATH = resolve(REPO_ROOT, "architecture/schema-sql-only-allowlist.json");

type Allowlist = {
  columns: string[];
  constraints: {
    check: string[];
    exclusion: string[];
    foreignKey: string[];
    unique: string[];
  };
  functions: string[];
  indexes: string[];
  queryOnly: {
    checks: string[];
    foreignKeys: string[];
    indexes: string[];
    uniqueConstraints: string[];
  };
  triggers: string[];
  views: string[];
};

type ColumnRow = {
  character_maximum_length: number | null;
  column_default: string | null;
  column_name: string;
  data_type: string;
  is_nullable: "NO" | "YES";
  table_name: string;
  udt_name: string;
};

export type ConstraintRow = {
  columns: string[];
  foreign_columns: string[] | null;
  foreign_table_name: string | null;
  kind: "c" | "f" | "p" | "u" | "x";
  name: string;
  nulls_not_distinct: boolean;
  on_delete: string;
  on_update: string;
  table_name: string;
};

type EnumRow = {
  enum_name: string;
  enum_value: string;
  sort_order: number;
};

type NamedRow = { name: string };

export type IndexRow = {
  columns: string[];
  flags: number[];
  method: string;
  name: string;
  predicate: string | null;
  table_name: string;
  unique: boolean;
};

type ExpectedColumn = {
  hasDefault: boolean;
  notNull: boolean;
  type: string;
};

type ModeledObjects = {
  checks: string[];
  columns: Map<string, ExpectedColumn>;
  enums: Map<string, string[]>;
  foreignKeys: string[];
  indexes: string[];
  primaryKeys: string[];
  tables: string[];
  uniqueConstraints: string[];
};

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function exactDrift(label: string, current: string[], baseline: string[]): string[] {
  const errors: string[] = [];
  for (const entry of difference(current, baseline)) errors.push(`${label} + ${entry}`);
  for (const entry of difference(baseline, current)) errors.push(`${label} - ${entry}`);
  return errors;
}

function normalizedSql(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

function modeledObjects(): ModeledObjects {
  const checks: string[] = [];
  const columns = new Map<string, ExpectedColumn>();
  const foreignKeys: string[] = [];
  const indexes: string[] = [];
  const primaryKeys: string[] = [];
  const tables: string[] = [];
  const uniqueConstraints: string[] = [];
  const dialect = new PgDialect();
  const drizzleTables = Object.values(querySchema).filter((value) => is(value, PgTable)) as PgTable[];

  for (const table of drizzleTables) {
    const config = getTableConfig(table);
    tables.push(config.name);
    for (const column of config.columns) {
      columns.set(`${config.name}.${column.name}`, {
        hasDefault: column.hasDefault,
        notNull: column.notNull,
        type: column.getSQLType(),
      });
      if (column.primary) primaryKeys.push(`${config.name}(${column.name})`);
      if (column.isUnique) {
        uniqueConstraints.push(
          `${config.name}(${column.name}):nullsNotDistinct=${column.uniqueType === "not distinct"}`,
        );
      }
    }
    checks.push(...config.checks.map((check) => check.name));
    foreignKeys.push(...config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return `${config.name}(${reference.columns.map((column) => column.name).join(",")})`
        + `->${getTableName(reference.foreignTable)}(${reference.foreignColumns.map((column) => column.name).join(",")})`
        + `:${foreignKey.onDelete ?? "no action"}:${foreignKey.onUpdate ?? "no action"}`;
    }));
    for (const index of config.indexes) {
      if (!index.config.name) throw new Error(`unnamed Drizzle index on ${config.name}`);
      const predicate = index.config.where ? dialect.sqlToQuery(index.config.where) : null;
      if (predicate && predicate.params.length > 0) {
        throw new Error(`parameterized Drizzle index predicate on ${index.config.name}`);
      }
      const indexColumns = index.config.columns.map((column) => {
        const indexed = column as { indexConfig?: { nulls?: string; order?: string }; name?: string };
        const expression = indexed.name ?? dialect.sqlToQuery(column as SQL).sql;
        const order = indexed.indexConfig?.order ?? "asc";
        const nulls = indexed.indexConfig?.nulls ?? (order === "asc" ? "last" : "first");
        return `${normalizedSql(expression)}:${order}:${nulls}`;
      });
      indexes.push(
        `${index.config.name}|table=${config.name}|unique=${index.config.unique}`
        + `|method=${index.config.method ?? "btree"}|columns=${indexColumns.join(",")}`
        + `|where=${normalizedSql(predicate?.sql)}`,
      );
    }
    primaryKeys.push(...config.primaryKeys.map((primaryKey) => (
      `${config.name}(${primaryKey.columns.map((column) => column.name).join(",")})`
    )));
    uniqueConstraints.push(...config.uniqueConstraints.map((constraint) => (
      `${config.name}(${constraint.columns.map((column) => column.name).join(",")})`
      + `:nullsNotDistinct=${constraint.nullsNotDistinct}`
    )));
  }

  const enums = new Map<string, string[]>();
  for (const value of Object.values(querySchema)) {
    if (isPgEnum(value)) enums.set(value.enumName, [...value.enumValues]);
  }

  return {
    checks: sorted(checks),
    columns,
    enums,
    foreignKeys: sorted(foreignKeys),
    indexes: sorted(indexes),
    primaryKeys: sorted(primaryKeys),
    tables: sorted(tables),
    uniqueConstraints: sorted(uniqueConstraints),
  };
}

function databaseType(row: ColumnRow): string {
  if (row.data_type === "ARRAY") return `${row.udt_name.slice(1)}[]`;
  if (row.data_type === "USER-DEFINED") return row.udt_name;
  if (row.data_type === "character varying") return `varchar(${row.character_maximum_length})`;
  return row.data_type;
}

export function databaseConstraintDescriptor(row: ConstraintRow): string {
  const local = `${row.table_name}(${row.columns.join(",")})`;
  if (row.kind === "f") {
    return `${local}->${row.foreign_table_name}(${row.foreign_columns?.join(",") ?? ""})`
      + `:${row.on_delete}:${row.on_update}`;
  }
  if (row.kind === "p") return local;
  if (row.kind === "u") return `${local}:nullsNotDistinct=${row.nulls_not_distinct}`;
  return row.name;
}

function groupConstraints(rows: ConstraintRow[]): Record<ConstraintRow["kind"], string[]> {
  return {
    c: sorted(rows.filter((row) => row.kind === "c").map(databaseConstraintDescriptor)),
    f: sorted(rows.filter((row) => row.kind === "f").map(databaseConstraintDescriptor)),
    p: sorted(rows.filter((row) => row.kind === "p").map(databaseConstraintDescriptor)),
    u: sorted(rows.filter((row) => row.kind === "u").map(databaseConstraintDescriptor)),
    x: sorted(rows.filter((row) => row.kind === "x").map(databaseConstraintDescriptor)),
  };
}

export function databaseIndexDescriptor(row: IndexRow): string {
  const columns = row.columns.map((column, index) => {
    const flags = row.flags[index] ?? 0;
    const order = (flags & 1) === 1 ? "desc" : "asc";
    const nulls = (flags & 2) === 2 ? "first" : "last";
    return `${column}:${order}:${nulls}`;
  });
  return `${row.name}|table=${row.table_name}|unique=${row.unique}`
    + `|method=${row.method}|columns=${columns.join(",")}`
    + `|where=${normalizedSql(row.predicate)}`;
}

async function inspectDatabase(database: PGlite) {
  const columns = await database.query<ColumnRow>(`
    select c.table_name, c.column_name, c.is_nullable, c.column_default,
           c.data_type, c.udt_name, c.character_maximum_length
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position
  `);
  const constraints = await database.query<ConstraintRow>(`
    select c.conname as name, c.contype as kind, table_class.relname as table_name,
           array(
             select attribute.attname
             from unnest(c.conkey) with ordinality as key(attnum, position)
             join pg_attribute attribute
               on attribute.attrelid = c.conrelid and attribute.attnum = key.attnum
             order by key.position
           ) as columns,
           foreign_class.relname as foreign_table_name,
           case when c.confkey is null then null else array(
             select attribute.attname
             from unnest(c.confkey) with ordinality as key(attnum, position)
             join pg_attribute attribute
               on attribute.attrelid = c.confrelid and attribute.attnum = key.attnum
             order by key.position
           ) end as foreign_columns,
           case c.confdeltype
             when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
             when 'n' then 'set null' when 'd' then 'set default' else ''
           end as on_delete,
           case c.confupdtype
             when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
             when 'n' then 'set null' when 'd' then 'set default' else ''
           end as on_update,
           coalesce(constraint_index.indnullsnotdistinct, false) as nulls_not_distinct
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    join pg_class table_class on table_class.oid = c.conrelid
    left join pg_class foreign_class on foreign_class.oid = c.confrelid
    left join pg_index constraint_index on constraint_index.indexrelid = c.conindid
    where n.nspname = 'public' and c.contype in ('c', 'f', 'p', 'u', 'x')
    order by c.contype, c.conname
  `);
  const enums = await database.query<EnumRow>(`
    select t.typname as enum_name, e.enumlabel as enum_value, e.enumsortorder as sort_order
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
  `);
  const functions = await database.query<NamedRow>(`
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by name
  `);
  const indexes = await database.query<IndexRow>(`
    select index_class.relname as name, table_class.relname as table_name,
           i.indisunique as unique, access_method.amname as method,
           array(
             select pg_get_indexdef(i.indexrelid, position, true)
             from generate_series(1, i.indnkeyatts) as position
             order by position
           ) as columns,
           array(
             select i.indoption[position]
             from generate_series(0, i.indnkeyatts - 1) as position
             order by position
           ) as flags,
           pg_get_expr(i.indpred, i.indrelid, true) as predicate
    from pg_index i
    join pg_class index_class on index_class.oid = i.indexrelid
    join pg_class table_class on table_class.oid = i.indrelid
    join pg_namespace n on n.oid = table_class.relnamespace
    join pg_am access_method on access_method.oid = index_class.relam
    left join pg_constraint c on c.conindid = i.indexrelid
    where n.nspname = 'public' and c.oid is null
    order by index_class.relname
  `);
  const triggers = await database.query<NamedRow>(`
    select table_class.relname || '.' || trigger.tgname as name
    from pg_trigger trigger
    join pg_class table_class on table_class.oid = trigger.tgrelid
    join pg_namespace n on n.oid = table_class.relnamespace
    where n.nspname = 'public' and not trigger.tgisinternal
    order by name
  `);
  const views = await database.query<NamedRow>(`
    select table_name as name
    from information_schema.views
    where table_schema = 'public'
    order by table_name
  `);

  return {
    columns: columns.rows,
    constraints: groupConstraints(constraints.rows),
    enums: enums.rows,
    functions: sorted(functions.rows.map((row) => row.name)),
    indexes: sorted(indexes.rows.map(databaseIndexDescriptor)),
    triggers: sorted(triggers.rows.map((row) => row.name)),
    views: sorted(views.rows.map((row) => row.name)),
  };
}

function sqlOnlyAllowlist(
  database: Awaited<ReturnType<typeof inspectDatabase>>,
  modeled: ModeledObjects,
): Allowlist {
  const databaseColumns = sorted(database.columns.map((row) => `${row.table_name}.${row.column_name}`));
  return {
    columns: difference(databaseColumns, sorted(modeled.columns.keys())),
    constraints: {
      check: difference(database.constraints.c, modeled.checks),
      exclusion: database.constraints.x,
      foreignKey: difference(database.constraints.f, modeled.foreignKeys),
      unique: difference(database.constraints.u, modeled.uniqueConstraints),
    },
    functions: database.functions,
    indexes: difference(database.indexes, modeled.indexes),
    queryOnly: {
      checks: difference(modeled.checks, database.constraints.c),
      foreignKeys: difference(modeled.foreignKeys, database.constraints.f),
      indexes: difference(modeled.indexes, database.indexes),
      uniqueConstraints: difference(modeled.uniqueConstraints, database.constraints.u),
    },
    triggers: database.triggers,
    views: database.views,
  };
}

function compareSchema(
  database: Awaited<ReturnType<typeof inspectDatabase>>,
  modeled: ModeledObjects,
  allowlist: Allowlist,
): string[] {
  const errors: string[] = [];
  const databaseTables = sorted(database.columns.map((row) => row.table_name));
  errors.push(...exactDrift("table", databaseTables, modeled.tables));

  const actualColumns = new Map(database.columns.map((row) => [
    `${row.table_name}.${row.column_name}`,
    row,
  ]));
  const sqlOnlyColumns = difference(sorted(actualColumns.keys()), sorted(modeled.columns.keys()));
  errors.push(...exactDrift("SQL-only column", sqlOnlyColumns, allowlist.columns));
  for (const [key, expected] of modeled.columns) {
    const actual = actualColumns.get(key);
    if (!actual) {
      errors.push(`column missing from migrations: ${key}`);
      continue;
    }
    const shape = {
      hasDefault: actual.column_default !== null,
      notNull: actual.is_nullable === "NO",
      type: databaseType(actual),
    };
    if (JSON.stringify(shape) !== JSON.stringify(expected)) {
      errors.push(`column shape ${key}: migrations=${JSON.stringify(shape)} drizzle=${JSON.stringify(expected)}`);
    }
  }

  const actualEnums = new Map<string, string[]>();
  for (const row of database.enums.sort((left, right) => left.sort_order - right.sort_order)) {
    actualEnums.set(row.enum_name, [...(actualEnums.get(row.enum_name) ?? []), row.enum_value]);
  }
  errors.push(...exactDrift("enum", sorted(actualEnums.keys()), sorted(modeled.enums.keys())));
  for (const [name, values] of modeled.enums) {
    if (JSON.stringify(actualEnums.get(name)) !== JSON.stringify(values)) {
      errors.push(`enum values ${name}: migrations=${JSON.stringify(actualEnums.get(name))} drizzle=${JSON.stringify(values)}`);
    }
  }

  errors.push(...exactDrift("primary key", database.constraints.p, modeled.primaryKeys));
  for (const modeledConstraint of [
    ["check", database.constraints.c, modeled.checks, allowlist.constraints.check, allowlist.queryOnly.checks],
    ["foreign key", database.constraints.f, modeled.foreignKeys, allowlist.constraints.foreignKey, allowlist.queryOnly.foreignKeys],
    ["unique", database.constraints.u, modeled.uniqueConstraints, allowlist.constraints.unique, allowlist.queryOnly.uniqueConstraints],
  ] as const) {
    const [label, actual, expected, sqlOnly, queryOnly] = modeledConstraint;
    errors.push(...exactDrift(`query-only ${label}`, difference(expected, actual), queryOnly));
    errors.push(...exactDrift(`SQL-only ${label}`, difference(actual, expected), sqlOnly));
  }
  errors.push(...exactDrift("SQL-only exclusion constraint", database.constraints.x, allowlist.constraints.exclusion));
  errors.push(...exactDrift("query-only index", difference(modeled.indexes, database.indexes), allowlist.queryOnly.indexes));
  errors.push(...exactDrift("SQL-only index", difference(database.indexes, modeled.indexes), allowlist.indexes));
  errors.push(...exactDrift("SQL-only function", database.functions, allowlist.functions));
  errors.push(...exactDrift("SQL-only trigger", database.triggers, allowlist.triggers));
  errors.push(...exactDrift("SQL-only view", database.views, allowlist.views));
  return errors;
}

async function main(): Promise<void> {
  const modeled = modeledObjects();
  const database = new PGlite();
  try {
    await applyProductMigrations(database, REPO_ROOT);
    const inspected = await inspectDatabase(database);
    const currentAllowlist = sqlOnlyAllowlist(inspected, modeled);
    if (process.argv.includes("--print-allowlist")) {
      console.log(JSON.stringify(currentAllowlist, null, 2));
      return;
    }
    const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allowlist;
    const errors = compareSchema(inspected, modeled, allowlist);
    if (errors.length > 0) {
      console.error("Schema drift detected:");
      for (const error of errors) console.error(`  ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Schema drift check passed: ${modeled.tables.length} tables, ${modeled.columns.size} modeled columns, `
      + `${modeled.enums.size} enums, ${readProductMigrations(REPO_ROOT).length} migrations.`,
    );
  } finally {
    await database.close();
  }
}

if (process.argv[1] && basename(process.argv[1]) === "check-schema-drift.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

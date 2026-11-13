/**
 * Test databases with the real migrations from drizzle/. Two engines:
 * - sqlite: node:sqlite adapter (fast, allows injecting a failure inside a batch);
 * - d1: Miniflare's local D1 (workerd), the same runtime used by `npm run dev`.
 * Only fictitious data is used.
 */
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../', import.meta.url);

export async function migrations(): Promise<string[]> {
  const dir = new URL('drizzle/', root);
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const statements: string[] = [];
  for (const file of files) statements.push(...(await readFile(new URL(file, dir), 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean));
  return statements;
}

type Bindable = string | number | null;
export type TestDb = { db: D1Database; engine: 'sqlite' | 'd1'; failOn?: (query: string) => boolean; raw: (query: string, ...values: Bindable[]) => Promise<Record<string, unknown>[]>; close: () => Promise<void> };

export async function sqliteDb(): Promise<TestDb> {
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  for (const statement of await migrations()) sql.exec(statement);
  const holder: TestDb = {} as TestDb;
  function prepare(query: string) {
    let values: Bindable[] = [];
    const stmt = {
      query,
      bind(...args: unknown[]) { values = args.map(v => v === undefined ? null : v) as Bindable[]; return stmt; },
      async first<T>() { return (sql.prepare(query).get(...values) ?? null) as T; },
      async all<T>() { return { results: sql.prepare(query).all(...values) as T[], success: true, meta: {} }; },
      async run() {
        if (holder.failOn?.(query)) throw new Error('Injected failure: ' + query.slice(0, 40));
        const result = sql.prepare(query).run(...values); return { success: true, meta: { changes: Number(result.changes) }, results: [] };
      },
    };
    return stmt;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sql.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  Object.assign(holder, { db, engine: 'sqlite', raw: async (q: string, ...v: Bindable[]) => sql.prepare(q).all(...v) as Record<string, unknown>[], close: async () => sql.close() });
  return holder;
}

export async function miniflareDb(): Promise<TestDb> {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null, { status: 404 }); } }', d1Databases: ['DB'] });
  const db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const statement of await migrations()) await db.prepare(statement).run();
  return { db, engine: 'd1', raw: async (q, ...v) => (await db.prepare(q).bind(...v).all<Record<string, unknown>>()).results, close: () => mf.dispose() };
}

/**
 * Loads an API route with the platform `env` import replaced by `globalThis.__testEnv`
 * and relative module paths made absolute. Validation, SQL and batching are unchanged.
 */
export async function loadRoute<T>(path: string, dev = false): Promise<T> {
  const file = new URL(path, root);
  let source = await readFile(file, 'utf8');
  source = source.replace("import { env } from 'cloudflare:workers';", 'const env = { get DB() { return globalThis.__testEnv?.DB; }, get OWNER_USER_IDS() { return globalThis.__testEnv?.OWNER_USER_IDS; } };')
    .replace(/from '(\.[^']+)'/g, (_m, rel: string) => `from ${JSON.stringify(new URL(rel, file).href)}`)
    .replaceAll('import.meta.env.DEV', String(dev));
  const js = stripTypeScriptTypes(source, { mode: 'strip' });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`) as Promise<T>;
}
export function setEnv(db: D1Database) { (globalThis as { __testEnv?: unknown }).__testEnv = { DB: db }; }

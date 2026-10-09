/**
 * Chainable Supabase client fake for unit tests.
 *
 *   const db = createSupabaseMock({ tables: { deals: [...] } });
 *   const supabaseService = asSupabaseService(db.client);
 *
 * `eq`, `neq`, `in`, `is`, `ilike`, `gte`, `lte`, `gt` and `lt` filter rows;
 * other modifiers are recorded and ignored so production query shapes never
 * throw. Every terminal query is pushed to `db.calls`.
 */

type Row = Record<string, any>;
type RpcHandler = (params: any) => any;

export interface SupabaseMockOptions {
  tables?: Record<string, Row[]>;
  rpc?: Record<string, RpcHandler | { data: any; error: any }>;
  errors?: Record<string, { message: string; code?: string }>;
}

export interface RecordedCall {
  table?: string;
  op?: string;
  rpc?: string;
  params?: any;
  modifiers?: [string, any[]][];
  payload?: any;
}

const PASSTHROUGH = [
  'select',
  'order',
  'limit',
  'range',
  'or',
  'not',
  'contains',
  'containedBy',
  'filter',
  'match',
  'textSearch',
  'returns',
  'csv',
];

const likeToRegExp = (pattern: string) => {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
};

export function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const store: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(options.tables || {})) {
    store[name] = rows.map((row) => ({ ...row }));
  }
  const calls: RecordedCall[] = [];

  const builder = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const modifiers: [string, any[]][] = [];
    let op = 'select';
    let payload: any = null;
    let single = false;
    let maybe = false;

    const finalize = (data: Row[]) => {
      if (single || maybe) {
        if (data.length === 0) {
          return maybe
            ? { data: null, error: null }
            : {
                data: null,
                error: { code: 'PGRST116', message: 'No rows found' },
              };
        }
        return { data: data[0], error: null };
      }
      return { data, error: null, count: data.length };
    };

    const run = () => {
      calls.push({ table, op, modifiers, payload });
      const error = options.errors?.[table];
      if (error) return { data: null, error };
      const rows = store[table] || (store[table] = []);
      const matches = rows.filter((row) => filters.every((f) => f(row)));
      if (op === 'insert' || op === 'upsert') {
        const inserted = [].concat(payload).map((r: Row) => ({ ...r }));
        rows.push(...inserted);
        return finalize(inserted);
      }
      if (op === 'update') {
        matches.forEach((row) => Object.assign(row, payload));
        return finalize(matches);
      }
      if (op === 'delete') {
        store[table] = rows.filter((row) => !matches.includes(row));
        return finalize(matches);
      }
      return finalize(matches);
    };

    const compare =
      (col: string, test: (a: any, b: any) => boolean) => (val: any) => {
        filters.push((row) => row[col] != null && test(row[col], val));
        return api;
      };

    const api: any = {
      insert: (p: any) => ((op = 'insert'), (payload = p), api),
      upsert: (p: any) => ((op = 'upsert'), (payload = p), api),
      update: (p: any) => ((op = 'update'), (payload = p), api),
      delete: () => ((op = 'delete'), api),
      eq: (col: string, val: any) => (
        filters.push((row) => row[col] === val),
        api
      ),
      neq: (col: string, val: any) => (
        filters.push((row) => row[col] !== val),
        api
      ),
      in: (col: string, vals: any[]) => (
        filters.push((row) => vals.includes(row[col])),
        api
      ),
      is: (col: string, val: any) => (
        filters.push((row) => (row[col] ?? null) === val),
        api
      ),
      ilike: (col: string, pattern: string) => {
        const re = likeToRegExp(pattern);
        filters.push((row) => re.test(String(row[col] ?? '')));
        return api;
      },
      gte: (col: string, val: any) => compare(col, (a, b) => a >= b)(val),
      lte: (col: string, val: any) => compare(col, (a, b) => a <= b)(val),
      gt: (col: string, val: any) => compare(col, (a, b) => a > b)(val),
      lt: (col: string, val: any) => compare(col, (a, b) => a < b)(val),
      single: () => ((single = true), api),
      maybeSingle: () => ((maybe = true), api),
      then: (resolve: any, reject: any) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    for (const name of PASSTHROUGH) {
      api[name] = (...args: any[]) => (modifiers.push([name, args]), api);
    }
    return api;
  };

  const client: any = {
    from: (table: string) => builder(table),
    rpc: async (name: string, params?: any) => {
      calls.push({ rpc: name, params });
      const handler = options.rpc?.[name];
      if (!handler) return { data: null, error: null };
      return typeof handler === 'function' ? handler(params) : handler;
    },
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  };

  return { client, store, calls };
}

/** Wraps a fake client in the shape of `SupabaseService`. */
export const asSupabaseService = (client: any) =>
  ({
    getClient: () => client,
    getAdminClient: () => client,
  }) as any;

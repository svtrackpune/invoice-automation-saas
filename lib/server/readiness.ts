export type ReadinessQueryResult = {
  error: {
    name?: string;
    code?: string;
  } | null;
};

export type ReadinessQuery = {
  select(columns: string): {
    limit(count: number): PromiseLike<ReadinessQueryResult>;
  };
};

export type ReadinessDatabase = {
  from(table: string): ReadinessQuery;
};

export async function checkDatabaseReadiness(
  db: ReadinessDatabase,
): Promise<boolean> {
  const { error } = await db.from('businesses').select('id').limit(1);
  return error === null;
}

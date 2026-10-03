export type ReadinessError = {
  name?: string;
  code?: string;
  message?: string;
};

export type ReadinessQueryResult = {
  error: ReadinessError | null;
};

export type ReadinessQuery = {
  select(columns: string): {
    limit(count: number): PromiseLike<ReadinessQueryResult>;
  };
};

export type ReadinessDatabase = {
  from(table: string): ReadinessQuery;
};

export async function getDatabaseReadiness(
  db: ReadinessDatabase,
): Promise<ReadinessQueryResult> {
  try {
    const result = await db.from('businesses').select('id').limit(1);
    return {
      error: result.error
        ? {
            name: result.error.name,
            code: result.error.code,
            message: result.error.message,
          }
        : null,
    };
  } catch (error) {
    return {
      error: {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function checkDatabaseReadiness(
  db: ReadinessDatabase,
): Promise<boolean> {
  const { error } = await getDatabaseReadiness(db);
  return error === null;
}

import { DatabaseService } from "../../src/database/database.service.js";

export type { DatabaseService };

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function createTestDb(): DatabaseService {
  if (!TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is required. " +
        "Start a disposable test database, e.g.: " +
        "docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 postgres:17 " +
        "then set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/bdl_test",
    );
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return new DatabaseService();
}

export async function initTestDb(): Promise<DatabaseService> {
  const db = createTestDb();
  await db.onModuleInit();
  return db;
}

type DbInternals = {
  pool: { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };
};

export function internals(db: DatabaseService): DbInternals {
  return db as unknown as DbInternals;
}

export async function truncateAll(db: DatabaseService): Promise<void> {
  await internals(db).pool.query(
    `TRUNCATE task, analysis_sub_task, ai_summary_task, app_settings, ai_prompt, ai_prompt_creator, summary, summary_segment RESTART IDENTITY CASCADE`,
  );
}

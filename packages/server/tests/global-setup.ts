import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required. " +
        "Start a disposable test database, e.g.: " +
        "docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 postgres:17 " +
        "then set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/bdl_test",
    );
  }
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  execSync(`pnpm exec prisma db init --db ${url}`, {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  execSync(`node scripts/ensure-pgvector.mjs`, {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

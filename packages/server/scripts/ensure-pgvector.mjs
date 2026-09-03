// 幂等 pgvector 引导：extension + contract 外的向量列（vector 列无法进入 Prisma contract）。
// 运行点：vitest globalSetup（db init 之后）与 server 容器启动链（db init 之后、main 之前）。
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(
    `ALTER TABLE summary_segment ADD COLUMN IF NOT EXISTS embedding vector(1024)`,
  );
  console.log("pgvector ensure OK");
} finally {
  await pool.end();
}

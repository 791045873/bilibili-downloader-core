const { DatabaseService } = await import("../dist/database/database.service.js");

const db = new DatabaseService();
try {
  await db.onModuleInit();
  console.log("Seed OK (builtin prompt ensured)");
} finally {
  await db.onApplicationShutdown();
}

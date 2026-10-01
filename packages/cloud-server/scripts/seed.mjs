const { DatabaseService } = await import("@bilibili-downloader/server-common");

const db = new DatabaseService();
try {
  await db.onModuleInit();
  console.log("Seed OK (builtin prompt ensured)");
} finally {
  await db.onApplicationShutdown();
}

import {
  Injectable,
  OnApplicationShutdown,
} from "@nestjs/common";
import postgres from "@prisma/orm-postgres/runtime";
import { Temporal } from "temporal-polyfill";
import type { Contract } from "../prisma/contract.d";
import contractJson from "../prisma/contract.json" with { type: "json" };

if (!(globalThis as { Temporal?: unknown }).Temporal) {
  (globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
}

export function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Set it to a PostgreSQL connection string.",
    );
  }
  return postgres<Contract>({ contractJson, url: databaseUrl });
}

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly db;

  constructor() {
    this.db = createPrismaClient();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

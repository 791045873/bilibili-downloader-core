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

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly db;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required. Set it to a PostgreSQL connection string.",
      );
    }
    this.db = postgres<Contract>({ contractJson, url: databaseUrl });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

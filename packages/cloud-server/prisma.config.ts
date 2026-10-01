import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: ormConfig({
    // contract 真源随 DB 层落在 server-common；cloud-server 持有一份配置以便部署链
    // （先连库播种/建表）与 vitest globalSetup 从本包执行 prisma db init / migrate。
    contract: "../server-common/src/prisma/contract.prisma",
    db: {
      connection: process.env.DATABASE_URL!,
    },
  }),
});

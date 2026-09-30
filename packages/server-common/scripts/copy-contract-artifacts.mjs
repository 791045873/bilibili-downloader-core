// tsc 只发出 .js/.d.ts 与被 import 的 .json；contract.d.ts 作为输入声明文件不会进 dist，
// 而 dist 内的 .d.ts 仍以 "../prisma/contract.d" 引用它，故构建后复制一份。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "src", "prisma");
const to = join(root, "dist", "prisma");

mkdirSync(to, { recursive: true });
for (const name of ["contract.d.ts", "contract.json", "contract.prisma"]) {
  copyFileSync(join(from, name), join(to, name));
}

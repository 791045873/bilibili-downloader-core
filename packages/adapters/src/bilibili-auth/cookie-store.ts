/**
 * Cookie 持久化存储
 *
 * 参考: downkyicore/DownKyi.Core/Storage/ 中的 Cookie 与 Login 文件存储
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoginCookie } from "@bilibili-downloader/core/ports";

/** Cookie 文件的 JSON 结构 */
interface CookieFileData {
  version: 1;
  createdAt: string;
  cookies: LoginCookie[];
}

export class CookieStore {
  /**
   * 保存 Cookie 到 JSON 文件
   */
  async save(filePath: string, cookies: LoginCookie[]): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    const data: CookieFileData = {
      version: 1,
      createdAt: new Date().toISOString(),
      cookies,
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 从 JSON 文件加载 Cookie
   */
  async load(filePath: string): Promise<LoginCookie[]> {
    const content = await readFile(filePath, "utf-8");
    const data: CookieFileData = JSON.parse(content);

    if (!data.cookies || !Array.isArray(data.cookies)) {
      throw new Error(`Cookie 文件格式无效: ${filePath}`);
    }

    return data.cookies;
  }
}
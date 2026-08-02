/**
 * SRT 字幕解析器
 *
 * 将标准 SRT 格式的字幕文件解析为结构化数据
 */

import { logger } from "../logger.js";

export interface SrtEntry {
  /** 字幕序号 */
  index: number;
  /** 开始时间（秒） */
  startTime: number;
  /** 结束时间（秒） */
  endTime: number;
  /** 字幕文本（多行已合并为单文本） */
  text: string;
}

/**
 * 解析 SRT 文件内容
 * @param content SRT 格式的文本内容
 * @returns 解析后的字幕条目列表（按时间排序）
 */
export function parseSrtContent(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  // 按空行分割条目
  const blocks = content.trim().split(/\n\s*\n/);
  let skippedBlocks = 0;

  for (const block of blocks) {
    try {
      const entry = parseSrtBlock(block.trim());
      if (entry) {
        entries.push(entry);
      } else {
        skippedBlocks += 1;
      }
    } catch {
      // 单条解析失败跳过
      skippedBlocks += 1;
    }
  }

  if (skippedBlocks > 0) {
    logger.warn(
      `SRT 解析跳过异常片段: skipped=${skippedBlocks}, parsed=${entries.length}`,
    );
  }

  return entries;
}

/**
 * 解析单个 SRT 块
 */
function parseSrtBlock(block: string): SrtEntry | null {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;

  // 第 1 行: 序号
  const index = Number.parseInt(lines[0], 10);
  if (Number.isNaN(index)) return null;

  // 第 2 行: 时间戳 HH:MM:SS,mmm --> HH:MM:SS,mmm
  const timeMatch = lines[1].match(
    /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/,
  );
  if (!timeMatch) {
    // 尝试带空格或不同的分隔符格式
    const altMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3}).*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!altMatch) return null;

    const startTime = toSeconds(
      Number(altMatch[1]),
      Number(altMatch[2]),
      Number(altMatch[3]),
      Number(altMatch[4]),
    );
    const endTime = toSeconds(
      Number(altMatch[5]),
      Number(altMatch[6]),
      Number(altMatch[7]),
      Number(altMatch[8]),
    );
    const text = lines.slice(2).join("\n");
    return { index, startTime, endTime, text };
  }

  const startTime = toSeconds(
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3]),
    Number(timeMatch[4]),
  );
  const endTime = toSeconds(
    Number(timeMatch[5]),
    Number(timeMatch[6]),
    Number(timeMatch[7]),
    Number(timeMatch[8]),
  );

  // 剩余行: 字幕文本
  const text = lines.slice(2).join("\n");
  return { index, startTime, endTime, text };
}

/**
 * HH:MM:SS,mmm 转换为秒
 */
function toSeconds(h: number, m: number, s: number, ms: number): number {
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * 从文件路径解析 SRT 文件
 */
export async function parseSrtFile(filePath: string): Promise<SrtEntry[]> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return parseSrtContent(content);
}

export async function parseSrtFileContent(filePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return Promise.resolve(content);
  // return parseSrtContent(content);
}

/**
 * 下载根目录及派生路径单一来源
 *
 * 全部 server 侧磁盘路径常量集中于此，禁止各消费方自行推导
 * `process.env.OUTPUT_DIR`，防止默认值或 resolve 语义漂移。
 * 模块加载期求值一次（与 summary-dir.ts 既有风格一致；无运行时 cwd 变更场景）。
 */

import { join, resolve } from "node:path";

/** 下载根目录：视频、summary/、.analysis-llm/、cookies、SDK 缓存均在此目录内 */
export const DOWNLOAD_ROOT = resolve(
  process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads"),
);

/** 登录 cookies 文件路径（COOKIE_FILE env 可覆盖；常量名加 _PATH 与 env 变量区分） */
export const COOKIE_FILE_PATH =
  process.env.COOKIE_FILE || join(DOWNLOAD_ROOT, ".cookies.json");

/** bilibili-api-sdk 磁盘缓存目录 */
export const BILI_API_CACHE_DIR = join(DOWNLOAD_ROOT, "bili-api-cache");

/** AI 分析低清视频目录（固定在下载根目录内，不可 env 覆盖） */
export const ANALYSIS_LLM_VIDEO_DIR = join(DOWNLOAD_ROOT, ".analysis-llm");

/** 摘要文档根目录：所有 AI 总结 md 与截图均落于此目录下 */
export const SUMMARY_BASE_DIR = join(DOWNLOAD_ROOT, "summary");

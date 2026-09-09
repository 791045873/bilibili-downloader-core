import { Injectable } from "@nestjs/common";
import { join, resolve } from "node:path";

/**
 * 下载根目录及派生路径单一来源（Nest 侧注入点）
 *
 * 全部 server 侧磁盘路径集中于此，禁止各消费方自行推导
 * `process.env.OUTPUT_DIR`，防止默认值或 resolve 语义漂移。
 *
 * DB 相对路径锚点约定（无例外）：DB 中所有磁盘相对路径
 * （`task.outputFile`、`analysis_sub_task.output_file`、
 * `ai_summary_task.summary_output`）
 * 一律相对 DOWNLOAD_ROOT 存储，读取时 join(DOWNLOAD_ROOT, value)；
 * 写入时由相应 helper 归一化为该锚点的 POSIX 相对路径。
 * `SUMMARY_BASE_DIR` 等派生目录仅用于运行时定位/挂载，不出现在 DB 值的锚点语义中
 * （summary_output 值自带 `summary/` 段，即由此派生目录位于下载根之下所致）。
 *
 * getter 每次访问时求值、不做缓存：对 ConfigModule 何时装载 .env
 * 零假设（env 进程内不可变，重复求值无语义代价），任何初始化顺序下都正确。
 * 测试/脚本直连实例化：`new PathsService()` 即可用，无需 DI 容器。
 */
@Injectable()
export class PathsService {
  /** 下载根目录：视频、summary/、.analysis-llm/、cookies、SDK 缓存均在此目录内 */
  get DOWNLOAD_ROOT(): string {
    return resolve(
      process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads"),
    );
  }

  /** 登录 cookies 文件路径（COOKIE_FILE env 可覆盖） */
  get COOKIE_FILE_PATH(): string {
    return process.env.COOKIE_FILE || join(this.DOWNLOAD_ROOT, ".cookies.json");
  }

  /** bilibili-api-sdk 磁盘缓存目录 */
  get BILI_API_CACHE_DIR(): string {
    return join(this.DOWNLOAD_ROOT, "bili-api-cache");
  }

  /** AI 分析低清视频目录（固定在下载根目录内，不可 env 覆盖） */
  get ANALYSIS_LLM_VIDEO_DIR(): string {
    return join(this.DOWNLOAD_ROOT, ".analysis-llm");
  }

  /** 摘要文档根目录：所有 AI 总结 md 与截图均落于此目录下 */
  get SUMMARY_BASE_DIR(): string {
    return join(this.DOWNLOAD_ROOT, "summary");
  }
}


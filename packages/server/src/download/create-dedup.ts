/**
 * 下载任务创建层去重判定 — 纯函数模块
 *
 * 口径（docs/requirements/2026-09-09-download-create-dedup.md）：
 * 同 (bvid,cid) 存在 created/downloading 任务，或存在 success 任务且其
 * outputFile（经 DOWNLOAD_ROOT 解析）在磁盘真实存在时，拒绝创建新任务。
 */

export interface CreateDedupInput {
  activeTaskExists: boolean;
  /** success 任务的 outputFile 原始 DB 值（无 success 记录时为 undefined/null） */
  completedOutputFile?: string | null;
  /** 该 outputFile 解析为绝对路径后的磁盘存在性 */
  fileExists: boolean;
}

export interface CreateDedupVerdict {
  block: boolean;
  message?: string;
}

export function decideCreateDedupVerdict(
  input: CreateDedupInput,
): CreateDedupVerdict {
  if (input.activeTaskExists) {
    return {
      block: true,
      message: "该视频已有排队中或下载中的任务，未重复创建",
    };
  }
  if (input.completedOutputFile && input.fileExists) {
    return { block: true, message: "该视频已下载且文件存在，未重复创建" };
  }
  return { block: false };
}

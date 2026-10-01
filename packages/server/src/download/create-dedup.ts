/**
 * 下载任务创建层去重判定 — 纯函数模块
 *
 * 口径（docs/requirements/2026-09-09-download-create-dedup.md + 2026-09-30 修订）：
 * 同 (bvid,cid) 存在 created/downloading 任务，或存在 success 任务时拒绝创建。
 * 自 Phase 3 云端/NAS 拆分起退化为**纯 DB 判定**：创建入口在 cloud-server，而
 * outputFile 所在磁盘只有 nas-worker 可见，故不再校验磁盘文件存在性（见该需求
 * 2026-09-30 修订段，AC3 已随之改写）。
 */

export interface CreateDedupInput {
  activeTaskExists: boolean;
  /** 同资源是否已有 success 任务（不再校验其 outputFile 的磁盘存在性） */
  completedTaskExists: boolean;
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
  if (input.completedTaskExists) {
    return { block: true, message: "该视频已下载，未重复创建" };
  }
  return { block: false };
}

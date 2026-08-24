/**
 * 将视频时间戳解析为候选秒数（按可能性降序，已去重）。
 *
 * 兼容模型返回的时间戳形态：
 * - hh:mm:ss（小时:分钟:秒）
 * - mm:ss（分钟:秒，允许分钟 ≥ 60，覆盖超过 1 小时的视频）
 * - 三段式实为 分:秒:毫秒/帧（如 05:32:40 表示 5 分 32 秒）时，默认 hh:mm:ss
 *   解读不成立（第三段 ≥ 60）或超出视频时长时，取前两段按 分钟:秒 重算。
 *
 * 不可解析时返回空数组。
 */
export function parseTimestampCandidates(timestamp: string): number[] {
  const normalized = timestamp.trim();
  const parts = normalized.split(":").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 2) return [];
  if (parts.some((part) => part.length === 0 || !/^\d+$/.test(part))) {
    return [];
  }
  const nums = parts.map((part) => Number(part));

  const candidates: number[] = [];
  if (nums.length === 3) {
    const [first, second, third] = nums;
    if (second < 60 && third < 60) {
      candidates.push(first * 3600 + second * 60 + third);
    }
    if (second < 60) {
      candidates.push(first * 60 + second);
    }
  } else {
    const [minutes, seconds] = nums;
    if (seconds < 60) {
      candidates.push(minutes * 60 + seconds);
    }
  }
  return [...new Set(candidates)];
}

/**
 * 从候选秒数中择优：duration 为有限非负时取第一个 ≤ duration 的候选；
 * duration 未知（undefined 或非法值）时取首候选；无可用候选返回 undefined。
 */
export function pickTimestampSeconds(
  candidates: number[],
  duration?: number,
): number | undefined {
  if (candidates.length === 0) return undefined;
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) {
    return candidates[0];
  }
  return candidates.find((c) => c <= duration);
}

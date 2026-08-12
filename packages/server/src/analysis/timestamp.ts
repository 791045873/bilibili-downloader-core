/**
 * 将视频时间戳（hh:mm:ss 或 mm:ss）转换为秒数。
 * 仅接受纯数字段，分钟/秒需 < 60；解析失败返回 undefined。
 */
export function transTimestampToSeconds(timestamp: string): number | undefined {
  const normalized = timestamp.trim();
  const parts = normalized.split(":").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 2) return undefined;
  if (parts.some((part) => part.length === 0 || !/^\d+$/.test(part))) {
    return undefined;
  }
  const nums = parts.map((part) => Number(part));
  const hours = nums.length === 3 ? nums[0] : 0;
  const minutes = nums.length === 3 ? nums[1] : nums[0];
  const seconds = nums.length === 3 ? nums[2] : nums[1];
  if (minutes >= 60 || seconds >= 60) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

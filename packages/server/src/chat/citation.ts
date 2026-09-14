/** 解析正文中的 [n] 引用标记（越界/非法忽略，去重升序） */
export function parseCitationNumbers(text: string, maxRef: number): number[] {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1 && n <= maxRef) {
      numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

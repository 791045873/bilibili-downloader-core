/**
 * 手动解析 `Cookie` 请求头（项目未装 cookie-parser，避免新增依赖）。
 * 仅做必要的拆分与解码；非法条目跳过，不抛错。
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "") continue;
    const raw = part.slice(eq + 1).trim();
    if (name in out) continue;
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/** 从 `Cookie` 头取指定 cookie 值 */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  return parseCookieHeader(header)[name];
}

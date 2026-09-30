import { describe, expect, it } from "vitest";
import { parseCookieHeader, readCookie } from "../../src/user-auth/cookie.util.js";

describe("cookie.util（手动解析 Cookie 头）", () => {
  it("解析多个 cookie 并去除空白", () => {
    expect(parseCookieHeader("a=1; b=2;c=3")).toEqual({ a: "1", b: "2", c: "3" });
    expect(parseCookieHeader("  a = 1 ; b= 2 ")).toEqual({ a: "1", b: "2" });
  });

  it("URL 解码；解码失败时回退原值", () => {
    expect(parseCookieHeader("t=a%20b")).toEqual({ t: "a b" });
    expect(parseCookieHeader("t=%E4%B8%AD")).toEqual({ t: "中" });
    expect(parseCookieHeader("t=%")).toEqual({ t: "%" });
  });

  it("空/非法条目跳过，不抛错", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
    expect(parseCookieHeader("noequals; =novalue; a=1")).toEqual({ a: "1" });
  });

  it("重复名取首个", () => {
    expect(parseCookieHeader("a=1; a=2")).toEqual({ a: "1" });
  });

  it("readCookie 取指定名，缺失返回 undefined", () => {
    expect(readCookie("bdl_session=tok; x=1", "bdl_session")).toBe("tok");
    expect(readCookie("x=1", "bdl_session")).toBeUndefined();
    expect(readCookie(undefined, "bdl_session")).toBeUndefined();
  });
});

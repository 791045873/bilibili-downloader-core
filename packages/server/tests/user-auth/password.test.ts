import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../src/user-auth/password.util.js";

describe("password.util（scrypt 口令哈希）", () => {
  it("hashPassword 产出 scrypt$salt$hash 且同口令两次哈希不同（随机 salt）", async () => {
    const a = await hashPassword("s3cret-pass");
    const b = await hashPassword("s3cret-pass");
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(a.split("$")).toHaveLength(3);
    expect(a).not.toBe(b);
  });

  it("verifyPassword 正确口令通过、错误口令拒绝", async () => {
    const stored = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", stored)).toBe(true);
    expect(await verifyPassword("wrong-pass", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("verifyPassword 对非法存储格式返回 false 而不抛错", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "scrypt$only-two")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$$")).toBe(false);
  });
});

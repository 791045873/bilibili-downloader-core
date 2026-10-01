import { describe, expect, it } from "vitest";
import { DownloadTaskService } from "../../src/download/download-task.service.js";

interface FakeClient {
  calls: (string | undefined)[];
  setCookieString(s: string | undefined): void;
}

function makeClient(): FakeClient {
  return {
    calls: [],
    setCookieString(s) {
      this.calls.push(s);
    },
  };
}

function makeDb() {
  const state = { cookie: undefined as string | undefined, version: 0 };
  return {
    state,
    getBiliCookieVersion: async () => state.version,
    getBiliCookie: async () => ({ cookie: state.cookie, version: state.version }),
    setBiliCookie: async (c: string) => {
      state.cookie = c ? c : undefined;
      state.version += 1;
      return state.version;
    },
  };
}

describe("DownloadTaskService cookie 版本刷新", () => {
  it("version 未变不刷新 SDK；version 变化则 setCookieString 被调用", async () => {
    const client = makeClient();
    const db = makeDb();
    const svc = new DownloadTaskService(db as never);
    (svc as unknown as { biliClient: FakeClient }).biliClient = client;

    await (svc as unknown as { refreshCookieIfChanged(): Promise<void> }).refreshCookieIfChanged();
    expect(client.calls).toHaveLength(0);

    db.state.cookie = "SESSDATA=ext";
    db.state.version = 7;
    await (svc as unknown as { refreshCookieIfChanged(): Promise<void> }).refreshCookieIfChanged();
    expect(client.calls).toEqual(["SESSDATA=ext"]);
    expect((svc as unknown as { cookieVersion: number }).cookieVersion).toBe(7);
    expect((svc as unknown as { cookieString?: string }).cookieString).toBe("SESSDATA=ext");

    // 版本已对齐，再次刷新不再调用
    await (svc as unknown as { refreshCookieIfChanged(): Promise<void> }).refreshCookieIfChanged();
    expect(client.calls).toHaveLength(1);
  });

  it("手动设置 cookie 写库 + 刷新 SDK + 更新版本缓存", async () => {
    const client = makeClient();
    const db = makeDb();
    const svc = new DownloadTaskService(db as never);
    (svc as unknown as { biliClient: FakeClient }).biliClient = client;

    await svc.setCookieManually("SESSDATA=manual");
    expect(client.calls).toEqual(["SESSDATA=manual"]);
    expect(db.state.cookie).toBe("SESSDATA=manual");
    expect(db.state.version).toBe(1);
    expect((svc as unknown as { cookieVersion: number }).cookieVersion).toBe(1);
    expect((svc as unknown as { cookieString?: string }).cookieString).toBe("SESSDATA=manual");
  });
});

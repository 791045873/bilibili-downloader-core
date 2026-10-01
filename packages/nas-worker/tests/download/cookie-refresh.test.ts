import { describe, expect, it } from "vitest";
import { DownloadExecutorService } from "../../src/download/download-executor.service.js";

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
  };
}

const fakePaths = { DOWNLOAD_ROOT: "/tmp/bdl-test" };

describe("DownloadExecutorService cookie 版本刷新", () => {
  it("version 未变不刷新 SDK；version 变化则 setCookieString 被调用", async () => {
    const client = makeClient();
    const db = makeDb();
    const svc = new DownloadExecutorService(db as never, fakePaths as never);
    (svc as unknown as { biliClient: FakeClient }).biliClient = client;

    await (svc as unknown as { ensureFreshCookie(): Promise<void> }).ensureFreshCookie();
    expect(client.calls).toHaveLength(0);

    db.state.cookie = "SESSDATA=job";
    db.state.version = 3;
    await (svc as unknown as { ensureFreshCookie(): Promise<void> }).ensureFreshCookie();
    expect(client.calls).toEqual(["SESSDATA=job"]);
    expect((svc as unknown as { cookieVersion: number }).cookieVersion).toBe(3);
    expect((svc as unknown as { cookieString?: string }).cookieString).toBe("SESSDATA=job");

    await (svc as unknown as { ensureFreshCookie(): Promise<void> }).ensureFreshCookie();
    expect(client.calls).toHaveLength(1);
  });
});

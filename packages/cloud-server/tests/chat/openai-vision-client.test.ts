import { describe, expect, it } from "vitest";
import {
  OpenAiVisionClient,
  deriveOpenAiBaseUrl,
} from "../../src/chat/openai-vision-client.js";
import type { LlmConfig } from "@bilibili-downloader/adapters";

describe("deriveOpenAiBaseUrl", () => {
  it("去掉结尾 /chat/completions 得到 baseURL", () => {
    expect(deriveOpenAiBaseUrl("http://vision-proxy:8765/v1/chat/completions")).toBe(
      "http://vision-proxy:8765/v1",
    );
  });

  it("容忍结尾斜杠", () => {
    expect(deriveOpenAiBaseUrl("http://p:8765/v1/chat/completions/")).toBe(
      "http://p:8765/v1",
    );
  });

  it("无该后缀时原样作为 baseURL", () => {
    expect(deriveOpenAiBaseUrl("http://p:8765/custom")).toBe("http://p:8765/custom");
  });
});

const BASE_CONFIG: LlmConfig = {
  apiKey: "sk-test-key",
  modelName: "qwen-vl-max",
  visionProxyUrl: "http://vision-proxy:8765/v1/chat/completions",
};

function okCompletion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "qwen-vl-max",
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
      usage: {},
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OpenAiVisionClient.multimodalChat", () => {
  it("命中 {base}/chat/completions，透传 enable_thinking/response_format/model 并解析 content 为 JSON", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedAuth = "";

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("authorization") ?? "";
      return okCompletion('{"question":"重写后的问题"}');
    }) as unknown as typeof fetch;

    const client = new OpenAiVisionClient(BASE_CONFIG, mockFetch);
    const result = await client.multimodalChat({
      stream: false,
      enable_thinking: false,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "原始问题" }],
    });

    expect(capturedUrl).toBe("http://vision-proxy:8765/v1/chat/completions");
    expect(capturedAuth).toBe("Bearer sk-test-key");
    expect(capturedBody.model).toBe("qwen-vl-max");
    expect(capturedBody.enable_thinking).toBe(false);
    expect(capturedBody.response_format).toEqual({ type: "json_object" });
    expect(capturedBody.messages).toEqual([{ role: "user", content: "原始问题" }]);

    expect(result.data).toEqual({ question: "重写后的问题" });
    expect(result.rawContent).toBe('{"question":"重写后的问题"}');
    expect(result.model).toBe("qwen-vl-max");
  });

  it("空 content 抛错", async () => {
    const mockFetch = (async () => okCompletion("")) as unknown as typeof fetch;
    const client = new OpenAiVisionClient(BASE_CONFIG, mockFetch);
    await expect(
      client.multimodalChat({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow("空响应");
  });

  it("Base64 媒体直接拒绝（不发请求）", async () => {
    const mockFetch = (async () => {
      throw new Error("不应发起请求");
    }) as unknown as typeof fetch;
    const client = new OpenAiVisionClient(BASE_CONFIG, mockFetch);
    await expect(
      client.multimodalChat({
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            ],
          },
        ],
      }),
    ).rejects.toThrow("Base64");
  });

  it("未配置 visionProxyUrl 时构造即抛错", () => {
    expect(
      () => new OpenAiVisionClient({ apiKey: "k", modelName: "m" }),
    ).toThrow("QWEN_VISION_PROXY_URL");
  });
});

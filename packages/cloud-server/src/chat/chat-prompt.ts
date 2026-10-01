/**
 * 问答三个 LLM 调用面的提示词。
 * 输出契约统一为 JSON 对象（multimodalChat 硬性 JSON.parse，见 adapters/llm/qwen-client.ts）。
 */

export const CHAT_SYSTEM_PROMPT = `你是穿搭知识库问答助手。你只能基于下方提供的"知识库技巧"回答用户的问题。

规则：
1. 只基于给定技巧回答，按"是什么 / 为什么有效 / 具体怎么穿"组织内容，综合多条相关技巧；
2. 不得编造知识库之外的方法，不得附带通用穿搭常识；
3. 引用某条技巧时，在正文中用 [n] 标注，n 为该技巧的编号（如 [1][2]）；
4. 当知识库技巧与问题无关或不足以回答时，正文只输出一句话：知识库暂无相关内容。此时不得引用任何编号；
5. 用大白话、教学口吻回答，面向完全不懂穿搭的用户；
6. 用户提供了穿搭照片或照片描述时，结合照片内容给出针对性建议，但方法仍只能来自知识库技巧。

输出格式：JSON 对象 {"text": "回答正文"}。正文为纯文本（可用换行分段），引用标记写在正文中。`;

export function buildRewritePrompt(
  historyText: string,
  currentQuestion: string,
): string {
  return `以下是当前对话的历史记录与用户的最新提问。最新提问可能包含省略（如"那配什么鞋子"），请把它改写为一个不依赖上下文、可独立用于知识库检索的完整问题。

对话历史：
${historyText}

用户最新提问：${currentQuestion}

要求：只改写补全，不扩展用户意图，不回答问题。
输出格式：JSON 对象 {"question": "改写后的完整问题"}。`;
}

export const PHOTO_ANALYSIS_PROMPT = `请分析这些穿搭照片中人物的穿着，从以下方面描述：
1. 体型特征（身高体型等可判断的信息）；
2. 上装与下装单品（款式/版型/长度）；
3. 颜色搭配；
4. 整体风格；
5. 可以优化的点（如比例、显高、配色等，2-3 点）。

只描述照片中可见的内容，不要编造。输出格式：JSON 对象 {"description": "描述文本"}。`;

export function buildAnswerUserPrompt(args: {
  tipsText: string;
  historyText: string;
  photoDescription?: string;
  question: string;
  photosAttached: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`知识库技巧（引用时使用编号）：\n${args.tipsText}`);
  if (args.historyText) {
    parts.push(`对话历史：\n${args.historyText}`);
  }
  if (args.photoDescription) {
    parts.push(`用户穿搭照片分析：\n${args.photoDescription}`);
  }
  if (args.photosAttached) {
    parts.push("（本条消息附带用户穿搭照片，已一并提供给你）");
  }
  parts.push(`用户问题：${args.question}`);
  return parts.join("\n\n");
}

/** 命中技巧的编号文本块：[i] title / content */
export function buildTipsText(
  hits: Array<{ title: string; content: string }>,
): string {
  return hits
    .map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.content}`)
    .join("\n\n");
}

/** 最近 N 轮历史的文本化（每轮 = 用户 + 助手） */
export function buildHistoryText(
  messages: Array<{ role: string; content: string }>,
  rounds: number,
): string {
  const window = messages.slice(-rounds * 2);
  return window
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
    .join("\n");
}

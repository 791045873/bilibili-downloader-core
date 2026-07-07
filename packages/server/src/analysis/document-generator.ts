/**
 * Markdown 文档生成器
 *
 * 将分析结果组装为图文并茂的 Markdown 总结文档
 */

export interface DocumentInput {
  /** 视频标题 */
  videoTitle: string;
  /** 整体总结文本 */
  summary: string;
  /** 关键段落列表 */
  segments: Array<{
    topic: string;
    subtitleText: string;
    selectedImages: Array<{
      /** 相对于 summary 目录的路径 */
      relativePath: string;
      /** 选中理由 → 图片说明 */
      reason: string;
    }>;
  }>;
  /** 是否为无内容文档 */
  emptySummary: boolean;
}

/**
 * 生成 Markdown 文档
 */
export function generateMarkdown(input: DocumentInput): string {
  if (input.emptySummary) {
    return `# ${input.videoTitle}\n\n[该视频无重点内容可总结]\n`;
  }

  const lines: string[] = [];

  // H1: 视频标题
  lines.push(`# ${input.videoTitle}`);
  lines.push("");

  // 整体总结
  lines.push("## 内容总结");
  lines.push("");
  lines.push(input.summary);
  lines.push("");

  // 重点内容
  lines.push("## 重点内容");
  lines.push("");

  for (const segment of input.segments) {
    // H3: 段落主题
    lines.push(`### ${segment.topic}`);
    lines.push("");

    // 截图（文字说明 + 图片）
    for (const img of segment.selectedImages) {
      lines.push(`![${img.reason}](${img.relativePath})`);
      lines.push("");
      lines.push(`> ${img.reason}`);
      lines.push("");
    }

    // 字幕原文引用
    lines.push("**相关原文：**");
    lines.push("> " + segment.subtitleText.replace(/\n/g, "\n> "));
    lines.push("");
  }

  return lines.join("\n");
}

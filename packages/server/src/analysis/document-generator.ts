/**
 * Markdown 文档生成器
 *
 * 将分析结果组装为图文并茂的 Markdown 总结文档
 */

export interface DocumentInput {
  /** 视频标题 */
  videoTitle: string;
  /** 视频链接（无则为空字符串） */
  videoUrl: string;
  /** 模型名称 */
  modelName: string;
  /** 文档创建时间 */
  createdAt: string;
  /** 关键段落列表 */
  segments: Array<{
    title: string;
    content: string;
    timestamp: string;
    frameDescription: string;
    images: Array<{
      /** 相对于 summary 目录的路径 */
      relativePath: string;
    }>;
  }>;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * 生成 Markdown 文档
 */
export function generateMarkdown(input: DocumentInput): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`title: ${yamlString(input.videoTitle)}`);
  lines.push(`video_url: ${yamlString(input.videoUrl)}`);
  lines.push(`model: ${yamlString(input.modelName)}`);
  lines.push(`created_at: ${yamlString(input.createdAt)}`);
  lines.push("---");
  lines.push("");

  // H1: 视频标题
  lines.push(`# ${input.videoTitle}`);
  lines.push("");

  for (const segment of input.segments) {
    // H2: 段落主题
    lines.push(`## ${segment.title}`);
    lines.push("");
    lines.push(segment.content);
    lines.push("");

    // 截图（文字说明 + 图片）
    for (const img of segment.images) {
      lines.push(`![${segment.frameDescription}](${img.relativePath})`);
      lines.push("");
      lines.push(`> ${segment.frameDescription}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

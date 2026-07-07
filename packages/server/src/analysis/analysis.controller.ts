import { BadRequestException, Controller, Post } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import type { LlmConfig } from "@bilibili-downloader/adapters/llm";

const DEBUG_VIDEO_FILENAME = "video1.mp4";
const DEBUG_SUBTITLE_FILENAME = "video1.srt";

@Controller("api/analysis")
export class AnalysisController {
  @Post("/debug")
  async debugAnalyze() {
    const input = await this.getDebugAnalysisInput();
    const engine = new AnalysisEngine(this.getLlmConfig());
    return engine.analyze(input);
  }

  private async getDebugAnalysisInput(): Promise<AnalysisInput> {
    const projectRoot = findProjectRoot(process.cwd());
    const videoPath = join(projectRoot, "test_assets", DEBUG_VIDEO_FILENAME);
    const subtitlePath = join(projectRoot, "test_assets", DEBUG_SUBTITLE_FILENAME);

    if (!existsSync(videoPath)) {
      throw new BadRequestException(`调试视频文件不存在: ${videoPath}`);
    }
    if (!existsSync(subtitlePath)) {
      throw new BadRequestException(`调试字幕文件不存在: ${subtitlePath}`);
    }

    return {
      videoPath,
      subtitlePath,
      summaryDir: join(projectRoot, "summaryDir"),
      videoTitle: await readVideoTitle(videoPath),
    };
  }

  private getLlmConfig(): LlmConfig {
    const apiKey = process.env.QWEN_API_KEY;
    const baseUrl = process.env.QWEN_API_BASE;
    const modelName = process.env.QWEN_MODEL;

    if (!apiKey) {
      throw new BadRequestException("缺少环境变量 QWEN_API_KEY");
    }
    if (!baseUrl) {
      throw new BadRequestException("缺少环境变量 QWEN_API_BASE");
    }
    if (!modelName) {
      throw new BadRequestException("缺少环境变量 QWEN_MODEL");
    }

    return { apiKey, baseUrl, modelName };
  }
}

function findProjectRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, "test_assets", DEBUG_VIDEO_FILENAME))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new BadRequestException(
        `无法从 ${startDir} 向上定位项目根目录下的 test_assets/${DEBUG_VIDEO_FILENAME}`,
      );
    }
    current = parent;
  }
}

function readVideoTitle(videoPath: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format_tags=title",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      const title = stdout.trim();
      if (code === 0 && title.length > 0) {
        resolve(title);
        return;
      }

      resolve(basename(videoPath, extname(videoPath)));
    });

    proc.on("error", () => {
      resolve(basename(videoPath, extname(videoPath)));
    });
  });
}

import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { createBilibiliWebClient, BilibiliStreamProvider } from "../packages/adapters/dist/bilibili/index.js";
import { FfmpegScreenshot } from "../packages/adapters/dist/ffmpeg/index.js";

const DEFAULT_BVIDS = [
  "BV1SoTx6yEYc",
  "BV1xx411c7mD",
  "BV1GJ411x7h7",
];

function parseBvids(argv) {
  const argBvids = argv.slice(2).map((v) => v.trim()).filter(Boolean);
  if (argBvids.length > 0) {
    return argBvids;
  }
  return DEFAULT_BVIDS;
}

async function runOneBvid(bvid) {
  const webClient = createBilibiliWebClient();
  const streamProvider = new BilibiliStreamProvider(webClient);
  const screenshotter = new FfmpegScreenshot();

  const info = await streamProvider.getVideoInfo(bvid);
  const firstPage = info.pages[0];
  if (!firstPage) {
    throw new Error(`视频 ${bvid} 没有可用分P，无法获取 cid`);
  }

  const streams = await streamProvider.getPlayStreams({
    bvid,
    cid: firstPage.cid,
    resourceType: "video",
  });

  if (!streams.videoStreams || streams.videoStreams.length === 0) {
    throw new Error(`视频 ${bvid} 未返回视频流`);
  }

  const lowQuality = [...streams.videoStreams].sort((a, b) => a.quality - b.quality)[0];
  const outputDir = join(process.cwd(), "summaryDir", "screenshots", "no-cookie-test");
  await mkdir(outputDir, { recursive: true });

  const result = await screenshotter.takeScreenshots({
    videoPath: lowQuality.url,
    timePoints: [5],
    outputDir,
    filenamePrefix: `no-cookie-${bvid}`,
    headers: {
      Referer: "https://www.bilibili.com",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (result.outputFiles.length === 0) {
    throw new Error(`视频 ${bvid} 截图结果为空`);
  }

  const outputFile = result.outputFiles[0];
  const fileStat = await stat(outputFile);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`视频 ${bvid} 截图文件无效: ${outputFile}`);
  }

  return {
    bvid,
    quality: lowQuality.quality,
    outputFile,
    fileSize: fileStat.size,
  };
}

async function main() {
  const bvids = parseBvids(process.argv);
  const errors = [];

  for (const bvid of bvids) {
    try {
      const ok = await runOneBvid(bvid);
      console.log("PASS");
      console.log(`bvid=${ok.bvid}`);
      console.log(`quality=${ok.quality}`);
      console.log(`file=${ok.outputFile}`);
      console.log(`size=${ok.fileSize}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${bvid}] ${msg}`);
      console.error(`FAIL ${bvid}: ${msg}`);
    }
  }

  console.error("All candidate videos failed.");
  for (const line of errors) {
    console.error(line);
  }
  process.exit(1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Unexpected error: ${msg}`);
  process.exit(1);
});

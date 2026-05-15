/**
 * Bilibili 下载器 Web 服务器
 */

import express from "express";
import { createBilibiliWebClient } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliResourceParser } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliStreamProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliFavoritesProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import { TaskStore } from "@bilibili-downloader/adapters/task-store";
import { DownloadSingleVideoUseCase } from "@bilibili-downloader/core/usecases";
import { DownloadFavoritesUseCase } from "@bilibili-downloader/core/usecases";
import { ResourceType } from "@bilibili-downloader/core/ports";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? join(homedir(), "bilibili-downloads");
const COOKIE_FILE = process.env.COOKIE_FILE ?? "";
const TASK_STORE_PATH = join(OUTPUT_DIR, ".tasks.json");

interface TaskEntry {
  id: string;
  input: string;
  status: string;
  title?: string;
  outputFile?: string;
  fileSize?: number;
  error?: string;
  progress?: number;
  speed?: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
}

const tasks = new Map<string, TaskEntry>();
const taskStore = new TaskStore(TASK_STORE_PATH);

async function main() {
  const cookieString = COOKIE_FILE ? await loadCookieString(COOKIE_FILE) : undefined;
  const webClient = createBilibiliWebClient({ cookieString });
  const fileStore = new NodeFileStore();
  const merger = new FfmpegMerger();

  await fileStore.ensureOutputDir(OUTPUT_DIR);

  if (!(await merger.isAvailable())) {
    console.error("⚠ ffmpeg 未安装，下载后无法合并!");
  }

  const commonDeps = {
    resourceParser: new BilibiliResourceParser(webClient),
    streamProvider: new BilibiliStreamProvider(webClient),
    mediaDownloader: new HttpDownloader(),
    mediaMerger: merger,
    fileStore,
    authProvider: new BilibiliAuthProvider(),
  };

  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => res.type("html").send(HTML_PAGE));

  app.post("/api/download", async (req, res) => {
    const { input, quality, codec } = req.body;
    if (!input) return res.status(400).json({ error: "缺少 input 参数" });

    const id = randomUUID();
    const task: TaskEntry = {
      id, input, status: "created",
      createdAt: new Date().toISOString(),
    };
    tasks.set(id, task);
    res.json({ id, message: "任务已创建" });

    executeDownload(id, input, quality, codec, commonDeps, webClient).catch(console.error);
  });

  app.get("/api/tasks", (_req, res) => {
    const list = Array.from(tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(list);
  });

  app.post("/api/tasks/clear", async (_req, res) => {
    tasks.clear();
    await taskStore.clear();
    res.json({ message: "已清空" });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 Bilibili 下载器已启动`);
    console.log(`   Web 界面: http://localhost:${PORT}`);
    console.log(`   输出目录: ${OUTPUT_DIR}\n`);
  });
}

async function executeDownload(
  id: string, input: string, quality: number | undefined,
  codec: string | undefined, deps: any, webClient: any,
) {
  const task = tasks.get(id)!;
  task.status = "parsing";
  try {
    const parseResult = await deps.resourceParser.parse(input);
    if (parseResult.type === ResourceType.Favorites && parseResult.mediaId) {
      const favsUseCase = new DownloadFavoritesUseCase({
        ...deps,
        favoritesProvider: new BilibiliFavoritesProvider(webClient),
      });
      await favsUseCase.execute(parseResult.mediaId, {
        input, outputDir: OUTPUT_DIR, quality, videoCodec: codec,
        cookieFile: COOKIE_FILE, skipExisting: true,
      });
      task.status = "completed";
    } else {
      const useCase = new DownloadSingleVideoUseCase(deps);
      useCase.on(DownloadEventType.TaskResolved, (e) => { task.title = e.plan.title; });
      useCase.on(DownloadEventType.DownloadProgress, (e) => {
        task.progress = e.percentage;
        task.speed = formatBytes(e.speedBytesPerSec) + "/s";
      });
      const result = await useCase.execute({
        input, outputDir: OUTPUT_DIR, quality, videoCodec: codec,
        cookieFile: COOKIE_FILE, skipExisting: true,
      });
      task.status = result.status;
      task.outputFile = result.outputFile;
      task.fileSize = result.fileSize;
      task.error = result.errorMessage;
      task.durationMs = result.timing?.totalMs;
    }
    task.completedAt = new Date().toISOString();
  } catch (err) {
    task.status = "failed";
    task.error = (err as Error).message;
  }
  await taskStore.save({
    id, request: { input, outputDir: OUTPUT_DIR, quality, videoCodec: codec },
    status: task.status as TaskStatus,
    outputFile: task.outputFile,
    errorMessage: task.error,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    durationMs: task.durationMs,
  });
}

async function loadCookieString(file: string): Promise<string | undefined> {
  try {
    const auth = new BilibiliAuthProvider();
    const cookies = await auth.loadCookies(file);
    return auth.toCookieString(cookies);
  } catch { return undefined; }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

main().catch((err) => { console.error("启动失败:", err); process.exit(1); });

// ===================== HTML =====================

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bilibili 下载器</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:14px/1.5 system-ui,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh}
.header{background:#16213e;padding:20px 30px;border-bottom:2px solid #0f3460}
.header h1{color:#e94560;font-size:24px}
.container{max-width:900px;margin:0 auto;padding:20px}
.card{background:#16213e;border-radius:8px;padding:20px;margin-bottom:20px;border:1px solid #0f3460}
.card h2{color:#e94560;margin-bottom:15px;font-size:18px}
.form-row{display:flex;gap:10px;flex-wrap:wrap}
input,select,button{padding:10px 14px;border-radius:6px;border:1px solid #0f3460;background:#1a1a2e;color:#e0e0e0;font-size:14px}
input{flex:1;min-width:200px}
button{cursor:pointer;background:#e94560;color:#fff;border:none;font-weight:bold;transition:background .2s}
button:hover{background:#c23152}
button:disabled{background:#555;cursor:not-allowed}
.task-list{list-style:none}
.task-item{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #0f3460;gap:10px;flex-wrap:wrap}
.task-item:last-child{border-bottom:none}
.task-info{flex:1;min-width:200px}
.task-title{font-weight:bold;color:#e94560;word-break:break-all}
.task-meta{font-size:12px;color:#888;margin-top:2px}
.task-status{padding:4px 10px;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap}
.status-running{background:#e94560;color:#fff}
.status-completed{background:#2ecc71;color:#fff}
.status-failed{background:#e74c3c;color:#fff}
.status-created{background:#f39c12;color:#fff}
.status-parsing{background:#3498db;color:#fff}
.empty{text-align:center;color:#666;padding:40px}
.progress-bar{width:120px;height:6px;background:#1a1a2e;border-radius:3px;overflow:hidden}
.progress-fill{height:100%;background:#e94560;transition:width .3s}
.refresh button{background:#0f3460;font-size:12px;padding:6px 14px}
</style>
</head>
<body>
<div class="header"><h1>🎬 Bilibili 下载器</h1></div>
<div class="container">
<div class="card">
<h2>📥 下发下载任务</h2>
<div class="form-row">
<input id="input" placeholder="BV号 / AV号 / URL / 合集ID" />
<select id="quality">
<option value="80">1080P</option><option value="64">720P</option>
<option value="120">4K</option><option value="32">480P</option>
<option value="16">360P</option>
</select>
<select id="codec">
<option value="">自动编码</option><option value="avc">AVC</option>
<option value="hevc">HEVC</option><option value="av1">AV1</option>
</select>
<button id="submit" onclick="submitTask()">开始下载</button>
</div></div>
<div class="card">
<div style="display:flex;justify-content:space-between;align-items:center">
<h2 style="margin:0">📋 任务列表</h2>
<div><button onclick="clearTasks()">清空</button>
<button onclick="refreshTasks()" style="margin-left:8px">刷新</button></div>
</div>
<ul id="taskList" class="task-list"><li class="empty">暂无任务</li></ul>
</div></div>
<script>
async function submitTask(){
const i=document.getElementById('input').value.trim();
if(!i){alert('请输入');return}
const b=document.getElementById('submit');b.disabled=true;b.textContent='创建中...';
try{
const r=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({input:i,quality:parseInt(document.getElementById('quality').value),
codec:document.getElementById('codec').value||undefined})});
if(!r.ok)throw new Error((await r.json()).error);
document.getElementById('input').value='';refreshTasks();
}catch(e){alert(e.message)}finally{b.disabled=false;b.textContent='开始下载'}
}
async function refreshTasks(){
const r=await fetch('/api/tasks');const ts=await r.json();
const l=document.getElementById('taskList');
if(!ts.length){l.innerHTML='<li class="empty">暂无任务</li>';return}
l.innerHTML=ts.map(t=>{
const sc={'created':'status-created','parsing':'status-parsing','resolving':'status-running','downloading':'status-running','merging':'status-running','completed':'status-completed','failed':'status-failed'}[t.status]||'status-running';
const st={'created':'等待中','parsing':'解析中','resolving':'解析中','downloading':'下载中','merging':'合并中','completed':'✅ 完成','failed':'❌ 失败'}[t.status]||t.status;
const p=t.progress!==undefined?'<div class="progress-bar"><div class="progress-fill" style="width:'+t.progress+'%"></div></div>':'';
const s=t.fileSize?' | '+fs(t.fileSize):'';
return '<li class="task-item"><div class="task-info"><div class="task-title">'+(t.title||t.input)+'</div><div class="task-meta">'+t.createdAt.split('T')[0]+' '+fd(t.createdAt)+s+'</div></div>'+p+'<span class="task-status '+sc+'">'+st+'</span></li>';
}).join('');
}
async function clearTasks(){await fetch('/api/tasks/clear',{method:'POST'});refreshTasks()}
function fs(b){if(!b)return'';const u=['B','KB','MB','GB'];const i=Math.floor(Math.log(b)/Math.log(1024));return(b/1024**i).toFixed(1)+' '+u[i]}
function fd(d){return new Date(d).toLocaleTimeString('zh-CN')}
refreshTasks();setInterval(refreshTasks,3000);
</script>
</body></html>`;
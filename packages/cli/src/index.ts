#!/usr/bin/env node
/**
 * bili-dl - Bilibili 视频下载 CLI 工具
 */

import { Command } from "commander";
import { createDownloadCommand } from "./commands/download.js";
import { createLoginCommand } from "./commands/login.js";
import { createHistoryCommand } from "./commands/history.js";

const program = new Command();

program
  .name("bili-dl")
  .description("Bilibili 视频下载工具 - 支持 BV/AV/URL")
  .version("0.0.1");

program.addCommand(createDownloadCommand());
program.addCommand(createLoginCommand());
program.addCommand(createHistoryCommand());

program.parse();
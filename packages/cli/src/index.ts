#!/usr/bin/env node
/**
 * bili-dl - Bilibili 视频下载 CLI 工具
 *
 * 用法:
 *   bili-dl download BV1xx411w7KC
 *   bili-dl login
 */

import { Command } from "commander";
import { createDownloadCommand } from "./commands/download.js";
import { createLoginCommand } from "./commands/login.js";

const program = new Command();

program
  .name("bili-dl")
  .description("Bilibili 视频下载工具 - 支持 BV/AV/URL")
  .version("0.0.1");

program.addCommand(createDownloadCommand());
program.addCommand(createLoginCommand());

program.parse();
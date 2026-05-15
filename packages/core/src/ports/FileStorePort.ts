/**
 * 文件存储端口 - 输出目录、临时目录、清理策略
 */
export interface FileStorePort {
  /**
   * 确保输出目录存在
   */
  ensureOutputDir(outputDir: string): Promise<void>;

  /**
   * 创建临时目录
   */
  createTempDir(): Promise<string>;

  /**
   * 清理临时目录
   */
  cleanTempDir(tempDir: string): Promise<void>;

  /**
   * 检查文件是否存在
   */
  exists(filePath: string): Promise<boolean>;

  /**
   * 获取文件大小 (bytes)
   */
  getFileSize(filePath: string): Promise<number>;
}
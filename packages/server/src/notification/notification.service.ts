import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { createLogMessage } from "../logging/server-log.util.js";

export interface SummaryNotificationInput {
  title: string;
  success: boolean;
  videoUrl?: string;
  markdownPath?: string;
  errorMessage?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly smtpHost = process.env.SMTP_HOST;
  private readonly smtpPort = Number(process.env.SMTP_PORT || 0);
  private readonly smtpSecure = process.env.SMTP_SECURE === "true";
  private readonly smtpUser = process.env.SMTP_USER;
  private readonly smtpPass = process.env.SMTP_PASS;
  private readonly notificationEmail = process.env.NOTIFICATION_EMAIL;

  private readonly transporter?: Transporter;

  constructor() {
    if (!this.hasValidConfig()) {
      this.logger.warn(
        "SMTP config missing, skipping notification (required: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/NOTIFICATION_EMAIL)",
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpSecure,
      auth: {
        user: this.smtpUser,
        pass: this.smtpPass,
      },
    });
  }

  async sendSummaryNotification(
    input: SummaryNotificationInput,
  ): Promise<void> {
    if (!this.transporter || !this.notificationEmail || !this.smtpUser) {
      this.logger.warn(
        createLogMessage(
          "Skipping summary notification because SMTP is not configured",
          {
            title: input.title,
            success: input.success,
          },
        ),
      );
      return;
    }

    const subject = input.success
      ? `AI 总结完成：${input.title}`
      : `AI 总结失败：${input.title}`;

    const lines: string[] = [`视频标题: ${input.title}`];

    if (input.videoUrl && input.videoUrl.trim().length > 0) {
      lines.push(`原始链接: ${input.videoUrl}`);
    }

    if (input.success) {
      if (input.markdownPath) {
        lines.push(`Markdown 路径: ${input.markdownPath}`);
      }
    } else {
      lines.push(`错误信息: ${input.errorMessage ?? "未知错误"}`);
    }

    try {
      await this.transporter.sendMail({
        from: this.smtpUser,
        to: this.notificationEmail,
        subject,
        text: lines.join("\n"),
      });
      this.logger.log(
        createLogMessage("Summary notification sent", {
          title: input.title,
          success: input.success,
          summaryPath: input.markdownPath,
          sourceType: "smtp",
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        createLogMessage("Summary notification failed", {
          title: input.title,
          success: input.success,
          error: msg,
          sourceType: "smtp",
        }),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private hasValidConfig(): boolean {
    return Boolean(
      this.smtpHost &&
      this.smtpPort > 0 &&
      this.smtpUser &&
      this.smtpPass &&
      this.notificationEmail,
    );
  }
}

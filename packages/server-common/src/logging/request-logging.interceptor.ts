import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { tap } from "rxjs";
import {
  buildRequestLogDetails,
  createLogMessage,
  summarizeError,
} from "./server-log.util.js";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      originalUrl?: string;
      url: string;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
    }>();
    const response = http.getResponse<{ statusCode: number }>();
    const startedAt = Date.now();
    const details = buildRequestLogDetails({
      method: request.method,
      route: request.originalUrl ?? request.url,
      params: request.params,
      query: request.query,
      body: request.body,
    });

    this.logger.log(createLogMessage("HTTP request started", details));

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            createLogMessage("HTTP request completed", {
              ...details,
              status: response.statusCode,
              durationMs: Date.now() - startedAt,
            }),
          );
        },
        error: (error: unknown) => {
          const status =
            error instanceof HttpException
              ? error.getStatus()
              : response.statusCode;

          this.logger.error(
            createLogMessage("HTTP request failed", {
              ...details,
              status,
              durationMs: Date.now() - startedAt,
              error: summarizeError(error),
            }),
          );
        },
      }),
    );
  }
}

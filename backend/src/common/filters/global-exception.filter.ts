// ──────────────────────────────────────────────
// Global Exception Filter — Structured Error Responses
// ──────────────────────────────────────────────

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorType, StructuredError } from '../types';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<any>();

    const structuredError = this.buildStructuredError(exception);
    const httpStatus = this.resolveHttpStatus(exception);
    const url = request?.url || '';

    if (httpStatus === HttpStatus.NOT_FOUND) {
      if (url.includes('firebase-messaging-sw.js')) {
        // Suppress developer noise from previous project service workers running on the same localhost port
        this.logger.log(`Ignoring service worker update request from previous project: ${url}`);
      } else {
        this.logger.warn(`[NotFound] Route not found: ${request?.method || 'GET'} ${url}`);
      }
    } else if (exception instanceof HttpException) {
      // Don't log full stack traces for controlled HTTP exceptions (e.g., 400 Bad Request, 401 Unauthorized)
      this.logger.warn(`[HttpException ${httpStatus}] ${structuredError.message}`);
    } else {
      this.logger.error(
        `[${structuredError.type}] ${structuredError.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(httpStatus).json(structuredError);
  }

  private buildStructuredError(exception: unknown): StructuredError {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const rawMessage =
        typeof response === 'string'
          ? response
          : (response as Record<string, unknown>).message?.toString() || exception.message;

      return {
        type: this.mapHttpStatusToErrorType(exception.getStatus()),
        message: this.humanize(rawMessage, exception.getStatus()),
        details:
          typeof response === 'object' ? (response as Record<string, unknown>) : undefined,
        timestamp: new Date().toISOString(),
      };
    }

    if (exception instanceof Error) {
      return {
        type: ErrorType.INTERNAL_ERROR,
        message: this.humanize(exception.message, 500),
        timestamp: new Date().toISOString(),
      };
    }

    return {
      type: ErrorType.INTERNAL_ERROR,
      message: 'Something unexpected happened. Please try again.',
      timestamp: new Date().toISOString(),
    };
  }

  /** Rewrite technical error messages into user-facing language. */
  private humanize(raw: string, status: number): string {
    const lower = raw.toLowerCase();

    if (status === 408 || lower.includes('timeout'))
      return 'That request took too long. Try a simpler question or reduce the data range.';
    if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('connect'))
      return 'The database connection was lost. Please reconnect.';
    if (lower.includes('permission') || lower.includes('access denied'))
      return 'You do not have permission to access that data.';

    // Keep messages that are already user-friendly (from our LLM prompts)
    if (lower.startsWith("i couldn") || lower.startsWith('no ') || raw.length < 120)
      return raw;

    // For long messages (e.g. ES ResponseError JSON), try to extract the meaningful reason
    if (raw.length > 200) {
      // Try to parse as JSON and extract top-level reason / error.reason
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const reason =
          (parsed.error as Record<string, unknown>)?.reason ??
          parsed.reason ??
          parsed.message;
        if (typeof reason === 'string' && reason.length > 0 && reason.length <= 300) {
          return reason;
        }
      } catch {
        // not JSON — fall through to truncation
      }
      // Non-JSON long string: surface the first meaningful sentence
      const firstSentence = raw.split(/[.\n]/)[0].trim();
      if (firstSentence.length > 10 && firstSentence.length <= 200) return firstSentence;
      return raw.substring(0, 200) + '...';
    }

    return raw;
  }

  private resolveHttpStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private mapHttpStatusToErrorType(status: number): ErrorType {
    switch (status) {
      case 400:
        return ErrorType.VALIDATION_REJECTION;
      case 401:
        return ErrorType.UNAUTHORIZED;
      case 408:
        return ErrorType.EXECUTION_TIMEOUT;
      case 422:
        return ErrorType.LLM_FORMAT_VIOLATION;
      default:
        return ErrorType.INTERNAL_ERROR;
    }
  }
}

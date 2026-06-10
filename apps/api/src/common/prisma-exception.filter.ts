import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Maps known Prisma errors to correct HTTP status codes instead of letting
 * them fall through to a generic 500.
 *
 * The motivating case: a malformed path param (e.g. a non-UUID client id like
 * `/clients/not-a-uuid`) makes Postgres reject the value and Prisma throw
 * `P2023`. Without this filter that surfaced as a 500 — a client error
 * reported as a server error, which also pollutes 5xx alarms.
 *
 * Only well-understood codes are remapped; anything else preserves the prior
 * 500 behavior so we don't accidentally mask a real server fault.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaExceptionFilter');

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    // A Prisma error can surface after a response has started streaming (SSE
    // endpoints run queries mid-stream). Writing status/JSON then would throw
    // ERR_HTTP_HEADERS_SENT from inside the filter — an unhandled rejection
    // that takes down the process on Node 20. End the stream instead.
    if (res.headersSent) {
      this.logger.error(
        `Prisma error ${exception.code} after response started: ${lastLine(exception.message)}`,
        exception.stack,
      );
      res.end();
      return;
    }

    switch (exception.code) {
      // P2023: inconsistent column data (e.g. invalid UUID syntax in a param).
      // P2000: value too long for the column's type.
      case 'P2023':
      case 'P2000':
        // Warn-log even though we answer 400: this branch reclassifies the
        // error as the client's fault, so without a log line a server-side
        // bad-value bug (e.g. a sync job building a malformed where-clause)
        // would vanish from both the 5xx alarms and the logs.
        this.logger.warn(`Prisma ${exception.code} mapped to 400: ${lastLine(exception.message)}`);
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request parameter' });
        return;
      // P2025: an operation depended on a record that does not exist.
      case 'P2025':
        res
          .status(HttpStatus.NOT_FOUND)
          .json({ statusCode: HttpStatus.NOT_FOUND, message: 'Not found' });
        return;
      default:
        // Preserve the previous 500 for anything we don't explicitly map, but
        // keep the full message, meta (model/column/target), and stack that
        // Nest's default handler would have logged.
        this.logger.error(
          `Unhandled Prisma error ${exception.code}: ${exception.message}` +
            (exception.meta ? ` meta=${JSON.stringify(exception.meta)}` : ''),
          exception.stack,
        );
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        });
        return;
    }
  }
}

/** Last line of a multi-line Prisma message — the human-readable cause. */
function lastLine(message: string): string {
  return message.split('\n').pop() ?? message;
}

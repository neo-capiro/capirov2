import 'reflect-metadata';
import { describe, expect, jest, test } from '@jest/globals';
import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientExceptionFilter } from './prisma-exception.filter.js';

function makeRes(headersSent = false) {
  const res = {
    headersSent,
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
  };
  res.status.mockReturnValue(res as never);
  return res;
}

function makeHost(res: ReturnType<typeof makeRes>): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res }),
  } as never;
}

function prismaError(code: string, message = `engine says no\nthe human-readable cause`) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '0.0.0-test',
  });
}

describe('PrismaClientExceptionFilter', () => {
  const filter = new PrismaClientExceptionFilter();

  test.each(['P2023', 'P2000'])('%s maps to 400 with a generic, non-leaking body', (code) => {
    const res = makeRes();

    filter.catch(prismaError(code), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Invalid request parameter',
    });
  });

  test('P2025 maps to 404', () => {
    const res = makeRes();

    filter.catch(prismaError('P2025'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      message: 'Not found',
    });
  });

  test('unmapped codes preserve the prior 500 with a generic body', () => {
    const res = makeRes();

    filter.catch(prismaError('P2002'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });

  test('after headers are sent (mid-stream error) it ends the response without writing status/json', () => {
    // Writing status/JSON after a stream has started would throw
    // ERR_HTTP_HEADERS_SENT inside the filter — the case the guard prevents.
    const res = makeRes(true);

    filter.catch(prismaError('P2025'), makeHost(res));

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});

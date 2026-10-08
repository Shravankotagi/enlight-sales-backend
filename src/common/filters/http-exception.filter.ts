import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiResponse } from '../types/api-response.types';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let errorMessage = 'Internal server error. Please try again later.';
    if (isHttpException) {
      const res: any = exception.getResponse();
      if (typeof res === 'string') {
        errorMessage = res;
      } else if (res && typeof res === 'object') {
        errorMessage = res.message || res.error || exception.message;
      } else {
        errorMessage = exception.message;
      }
    } else {
      console.error('[UNHANDLED SERVER EXCEPTION]:', exception);
    }

    const errorResponse: ApiResponse<null> = {
      success: false,
      data: null,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).send(errorResponse);
  }
}

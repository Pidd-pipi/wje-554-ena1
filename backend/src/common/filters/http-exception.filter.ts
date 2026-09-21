import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : '系统异常';
    const raw = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
    const message = Array.isArray(raw) ? raw.join('；') : raw || '请求失败';
    response.status(status).json({
      code: status,
      message,
      details: typeof body === 'object' ? body : undefined
    });
  }
}

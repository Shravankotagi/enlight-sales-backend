import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { accountsRequestAllowed } from './invoice-access';

@Injectable()
export class AccountsBoundaryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const allowed = accountsRequestAllowed(
      request.employee,
      request.method || 'GET',
      request.path || request.url || '',
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Accounts can only use invoices and the assistant.',
      );
    }
    return next.handle();
  }
}

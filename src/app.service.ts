import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getDefaultMessage(): string {
    return `
      <div style="text-align: center">
        <h1> Welcome to Supabase Backend Service! (Build: v2026-08-12-FIXED) </h1>
      </div>
    `;
  }
}

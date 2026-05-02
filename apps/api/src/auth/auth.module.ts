import { Global, Module } from '@nestjs/common';
import { ClerkService } from './clerk.service.js';
import { RolesGuard } from './roles.guard.js';

@Global()
@Module({
  providers: [ClerkService, RolesGuard],
  exports: [ClerkService, RolesGuard],
})
export class AuthModule {}

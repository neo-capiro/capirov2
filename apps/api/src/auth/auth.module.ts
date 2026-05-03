import { Global, Module } from '@nestjs/common';
import { ClerkService } from './clerk.service.js';
import { ClerkProvisioningService } from './clerk-provisioning.service.js';
import { RolesGuard } from './roles.guard.js';

@Global()
@Module({
  providers: [ClerkService, ClerkProvisioningService, RolesGuard],
  exports: [ClerkService, ClerkProvisioningService, RolesGuard],
})
export class AuthModule {}

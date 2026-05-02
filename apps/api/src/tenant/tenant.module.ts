import { Global, Module } from '@nestjs/common';
import { TenantContextMiddleware } from './tenant-context.middleware.js';
import { TenantContextStore } from './tenant-context.store.js';

@Global()
@Module({
  providers: [TenantContextStore, TenantContextMiddleware],
  exports: [TenantContextStore, TenantContextMiddleware],
})
export class TenantModule {}

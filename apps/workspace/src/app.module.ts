import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}

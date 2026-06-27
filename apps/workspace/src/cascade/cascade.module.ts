import { Module } from '@nestjs/common';
import { CascadeController, ProductsController } from './cascade.controller.js';
import { CascadeService } from './cascade.service.js';

@Module({
  controllers: [CascadeController, ProductsController],
  providers: [CascadeService],
  exports: [CascadeService],
})
export class CascadeModule {}

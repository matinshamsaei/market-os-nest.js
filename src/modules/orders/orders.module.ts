import { Module } from '@nestjs/common';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { EventsModule } from '../events/events.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WalletModule } from '../wallet/wallet.module';

import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { OrderStateMachine } from './helpers';

@Module({
  imports: [AuthModule, CartModule, EventsModule, InventoryModule, PrismaModule, WalletModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, OrderStateMachine],
  exports: [OrdersService, OrdersRepository, OrderStateMachine],
})
export class OrdersModule {}

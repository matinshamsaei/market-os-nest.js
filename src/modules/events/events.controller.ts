import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { DomainEventResponseDto } from './dto';
import { EventDeliveryService } from './event-delivery.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EventsController {
  constructor(private readonly eventDeliveryService: EventDeliveryService) {}

  @Get('failed')
  @ApiOperation({ summary: 'List failed and dead-letter domain events' })
  @ApiOkResponse({ type: DomainEventResponseDto, isArray: true })
  listFailed(@CurrentUser() user: TokenPayload) {
    return this.eventDeliveryService.listFailed(user);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or dead-letter domain event' })
  @ApiParam({ name: 'id', description: 'Domain event id' })
  @ApiOkResponse({ type: DomainEventResponseDto })
  retry(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    return this.eventDeliveryService.retry(id, user);
  }
}

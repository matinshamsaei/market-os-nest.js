import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import {
  GetNotificationsQueryDto,
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
  ReadAllNotificationsResponseDto,
  UnreadCountResponseDto,
} from './dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.ADMIN)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiOkResponse({ type: PaginatedNotificationsResponseDto })
  getNotifications(@CurrentUser() user: TokenPayload, @Query() query: GetNotificationsQueryDto) {
    return this.notificationsService.getNotifications(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications for the current user' })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  getUnreadCount(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.getUnreadCount(user);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every unread notification for the current user as read' })
  @ApiOkResponse({ type: ReadAllNotificationsResponseDto })
  markAllAsRead(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.markAllAsRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', description: 'Notification id' })
  @ApiOkResponse({ type: NotificationResponseDto })
  markAsRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: TokenPayload) {
    return this.notificationsService.markAsRead(id, user);
  }
}

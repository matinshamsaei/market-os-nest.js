import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { NotificationPreferencesResponseDto, UpdateNotificationPreferencesDto } from './dto';
import { NotificationPreferencesService } from './notification-preferences.service';

@ApiTags('notification-preferences')
@ApiBearerAuth()
@Controller('notification-preferences')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.ADMIN)
export class NotificationPreferencesController {
  constructor(private readonly preferencesService: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'List notification preferences for the current user' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  getPreferences(@CurrentUser() user: TokenPayload) {
    return this.preferencesService.getPreferences(user);
  }

  @Put()
  @ApiOperation({ summary: 'Update notification preferences for the current user' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  updatePreferences(
    @CurrentUser() user: TokenPayload,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return this.preferencesService.updatePreferences(user, body.preferences);
  }
}

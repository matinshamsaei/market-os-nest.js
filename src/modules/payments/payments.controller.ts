import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import type { TokenPayload } from '@/shared/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreatePaymentDto,
  CreatePaymentResponseDto,
  PaymentResponseDto,
  WebhookResponseDto,
} from './dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Create a payment and get a redirect URL' })
  @ApiCreatedResponse({ type: CreatePaymentResponseDto })
  createPayment(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreatePaymentDto,
  ): Promise<CreatePaymentResponseDto> {
    return this.paymentsService.createPayment(user, dto);
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive payment provider webhooks' })
  @ApiHeader({ name: 'x-webhook-signature', required: false })
  @ApiHeader({ name: 'x-payment-provider', required: false })
  @ApiOkResponse({ type: WebhookResponseDto })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature?: string,
    @Headers('x-payment-provider') providerHint?: string,
  ): Promise<WebhookResponseDto> {
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});

    return this.paymentsService.handleWebhook(rawBody, signature, providerHint);
  }

  @Get('failed')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List failed payments' })
  @ApiOkResponse({ type: PaymentResponseDto, isArray: true })
  listFailedPayments(@CurrentUser() user: TokenPayload): Promise<PaymentResponseDto[]> {
    return this.paymentsService.listFailedPayments(user);
  }

  @Post(':id/retry')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Retry a failed payment' })
  @ApiCreatedResponse({ type: CreatePaymentResponseDto })
  retryFailedPayment(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CreatePaymentResponseDto> {
    return this.paymentsService.retryFailedPayment(id, user);
  }
}

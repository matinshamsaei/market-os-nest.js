import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PaymentsService } from '../payments.service';

@Injectable()
export class PaymentsReconciliationJob {
  private readonly logger = new Logger(PaymentsReconciliationJob.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const result = await this.paymentsService.reconcileStalePayments();
    this.logger.log(
      `Payment reconciliation finished: checked=${result.checked} repaired=${result.repaired}`,
    );
  }
}

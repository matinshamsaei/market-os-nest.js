import { Injectable } from '@nestjs/common';

import { EmailProvider, OutboundEmail } from './notification-channel';

@Injectable()
export class FakeEmailProvider implements EmailProvider {
  readonly sent: OutboundEmail[] = [];

  send(email: OutboundEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}

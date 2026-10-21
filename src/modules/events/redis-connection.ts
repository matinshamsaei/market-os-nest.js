import { ConfigService } from '@nestjs/config';
import { ConnectionOptions } from 'bullmq';

export function createRedisConnection(configService: ConfigService): ConnectionOptions {
  return {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: Number(configService.get<string>('REDIS_PORT', '6379')),
    maxRetriesPerRequest: null,
  };
}

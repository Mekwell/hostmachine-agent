import Redis from 'ioredis';
import { DockerService } from './docker.service';
import { getConfig } from '../config';
import logger from '../logger';

export class StatsStreamService {
  private redis: Redis;
  private isStreaming = false;

  constructor(private dockerService: DockerService) {
    const config = getConfig();
    const redisHost = config.CONTROLLER_URL.replace('http://', '').replace(':3000', '');
    
    this.redis = new Redis({
        host: redisHost, 
        port: 6379,
        lazyConnect: true,
        retryStrategy: (times) => Math.min(times * 50, 2000), // Aggressive retry for telemetry
    });

    this.redis.on('error', (err) => {
        logger.debug(`StatsStream: Redis error: ${err.message}`);
    });
    
    this.redis.connect().catch(e => {
        logger.warn(`StatsStream: Redis connection failed: ${e.message}`);
    });
  }

  startStreaming() {
    if (this.isStreaming) return;
    this.isStreaming = true;
    logger.info('StatsStream: Started real-time telemetry loop (2s)');

    setInterval(async () => {
        try {
            const stats = await this.dockerService.getContainerStats();
            for (const [serverId, data] of Object.entries(stats)) {
                // Publish to Redis
                this.redis.publish(`stats:${serverId}`, JSON.stringify(data));
            }
        } catch (e: any) {
            logger.error(`StatsStream: Failed to fetch/publish stats: ${e.message}`);
        }
    }, 2000);
  }
}

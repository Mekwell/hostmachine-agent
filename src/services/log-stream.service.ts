import Redis from 'ioredis';
import { DockerService } from './docker.service';
import { getConfig } from '../config';
import logger from '../logger';
import Docker from 'dockerode';

export class LogStreamService {
  private redis: Redis;
  private docker: Docker;
  private activeStreams: Map<string, any> = new Map();

  constructor(private dockerService: DockerService) {
    this.docker = new Docker();
    const config = getConfig();
    
    // Connect to Controller's Redis
    // We assume CONTROLLER_URL is http://<IP>:3000, so we strip port/protocol
    const redisHost = config.CONTROLLER_URL.replace('http://', '').replace(':3000', '');
    
    logger.info(`LogStream: Connecting to Redis at ${redisHost}:6379`);
    this.redis = new Redis({
        host: redisHost, 
        port: 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true
    });
    
    this.redis.connect().catch(e => {
        logger.warn(`LogStream: Redis connection failed: ${e.message}`);
    });
  }

  async streamLogs(containerId: string, serverId: string) {
    if (this.activeStreams.has(containerId)) return;

    logger.info(`LogStream: Starting stream for ${containerId} -> logs:${serverId}`);

    try {
        const container = this.docker.getContainer(containerId);
        const stream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 50 // Send last 50 lines immediately
        });

        this.activeStreams.set(containerId, stream);

        stream.on('data', (chunk) => {
            // Docker sends header bytes, usually need stripping but raw string might be fine for simple console
            const logLine = chunk.toString('utf8'); 
            // Publish to Redis Channel
            this.redis.publish(`logs:${serverId}`, logLine);
        });

        stream.on('end', () => {
            this.activeStreams.delete(containerId);
            logger.info(`LogStream: Stream ended for ${containerId}`);
        });

    } catch (e: any) {
        logger.error(`LogStream: Failed to attach to ${containerId}`, e.message);
    }
  }

  // Identify all game servers and start streaming
  async startAllStreams() {
      const containers = await this.dockerService.listContainers();
      for (const c of containers) {
          // Check if this container uses the internal Runner (Sidecar)
          // If so, we skip Agent-based streaming to avoid duplicate logs.
          if (c.Labels && c.Labels['hostmachine.runner'] === 'true') {
              logger.info(`LogStream: Skipping ${c.Names[0]} (Runner active)`);
              continue;
          }

          // Heuristic: If it has our label or is in our tracked list (simplified: name=serverId)
          // For now, we assume container Name IS the Server ID
          const serverId = c.Names[0].replace('/', '');
          this.streamLogs(c.Id, serverId);
      }
  }
}

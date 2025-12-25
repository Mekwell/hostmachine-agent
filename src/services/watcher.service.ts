import { DockerService } from './docker.service';
import { getConfig } from '../config';
import logger from '../logger';
import axios from 'axios';
import Docker from 'dockerode';

export class WatcherService {
  private docker: Docker;

  constructor(private dockerService: DockerService) {
    this.docker = new Docker();
  }

  startWatching() {
    logger.info('HostBot Watcher: Listening for container events...');
    this.docker.getEvents({ filters: { type: ['container'], event: ['die'] } }, (err, stream) => {
      if (err) {
        logger.error('HostBot Watcher failed to attach to events:', err);
        return;
      }
      if (!stream) {
          return;
      }

      stream.on('data', async (chunk) => {
        try {
          const event = JSON.parse(chunk.toString());
          await this.handleContainerDie(event);
        } catch (e) {
          logger.warn('Failed to parse Docker event', e);
        }
      });
    });
  }

  private async handleContainerDie(event: any) {
    const containerId = event.id;
    const containerName = event.Actor.Attributes.name.replace(/^\//, ''); // Clean leading slash
    const exitCode = event.Actor.Attributes.exitCode;

    // Ignore clean exits (0) or SIGKILL (137) usually triggered by user stopping server
    if (exitCode === '0' || exitCode === '137' || exitCode === '143') {
        logger.debug(`Container ${containerName} stopped gracefully (Code ${exitCode}). Ignoring.`);
        return;
    }

    logger.warn(`HostBot Alert: Container ${containerName} died unexpectedly with code ${exitCode}. Generating Report...`);

    try {
        const logs = await this.dockerService.getContainerLogs(containerId);
        await this.sendReport(containerId, containerName, logs, exitCode);
    } catch (err: any) {
        logger.error(`Failed to report crash for ${containerName}`, err.message);
    }
  }

  public async scanLogsForLiveErrors(containerId: string, containerName: string, chunk: string) {
      const criticalPatterns = [
          'java.lang.outofmemoryerror',
          'segmentation fault',
          'no space left on device',
          'address already in use',
          'corrupt chunk'
      ];

      const lowerChunk = chunk.toLowerCase();
      if (criticalPatterns.some(p => lowerChunk.includes(p))) {
          logger.warn(`HostBot Live Detection: Found critical error in ${containerName} logs. Reporting...`);
          await this.sendReport(containerId, containerName, chunk, 'LIVE_DETECTION');
      }
  }

  private async sendReport(containerId: string, containerName: string, logs: string, exitCode: string) {
      const config = getConfig();
      try {
          await axios.post(`${config.CONTROLLER_URL}/ai/report`, {
              containerId,
              containerName,
              logs,
              exitCode
          }, {
              headers: {
                  'x-node-id': config.NODE_ID,
                  'x-api-key': config.API_KEY
              }
          });
          logger.info(`HostBot Report transmitted for ${containerName}`);
      } catch (err: any) {
          logger.error('Failed to transmit HostBot report', err.message);
      }
  }
}

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
          logger.debug(`Docker Event: ${event.Action} for ${event.id || 'N/A'}`);
          await this.handleContainerDie(event);
        } catch (e) {
          logger.warn('Failed to parse Docker event', e);
        }
      });
    });
  }

  private async handleContainerDie(event: any) {
    const containerId = event.id || event.ID; // Handle potential case differences
    const attributes = event.Actor?.Attributes || {};
    const containerName = (attributes.name || 'unknown').replace(/^\//, ''); 
    const exitCode = attributes.exitCode;

    if (!containerId) {
        logger.warn(`Die event received without ID: ${JSON.stringify(event)}`);
        return;
    }

    // Ignore clean exits (0) or SIGKILL (137) usually triggered by user stopping server
    if (exitCode === '0' || exitCode === '137' || exitCode === '143') {
        logger.debug(`Container ${containerName} stopped gracefully (Code ${exitCode}). Ignoring.`);
        return;
    }

    logger.warn(`HostBot Alert: Container ${containerName} died unexpectedly with code ${exitCode}. Generating Report...`);

    let logs = 'Could not retrieve logs.';
    try {
        // Capture the last 100 lines for context
        logs = await this.dockerService.getContainerLogs(containerId);
    } catch (err: any) {
        logger.error(`Failed to fetch logs for crashed container ${containerName}: ${err.message}`);
    }

    try {
        await this.sendReport(containerId, containerName, logs, exitCode);
    } catch (err: any) {
        logger.error(`Failed to transmit crash report for ${containerName}: ${err.message}`);
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

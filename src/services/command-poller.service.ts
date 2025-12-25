import axios from 'axios';
import { getConfig } from '../config';
import logger from '../logger';
import { DockerService } from './docker.service';

interface CommandPayload {
  id: string;
  type: 'START_SERVER' | 'STOP_SERVER' | 'RESTART_SERVER' | 'UPDATE_AGENT' | 'LIST_FILES' | 'GET_FILE' | 'WRITE_FILE' | 'DELETE_FILE' | 'EXEC_COMMAND' | 'GET_LOGS';
  payload: any;
}

export class CommandPollerService {
  private isPolling = false;
  private nodeId: string | null = null; 

  constructor(private dockerService: DockerService) {}

  public setNodeId(id: string) {
    this.nodeId = id;
  }

  public startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    logger.info('Started Command Poller Loop (Interval: 2s)');
    
    // Initial Poll
    this.poll();

    // Loop
    setInterval(() => this.poll(), 2000);
  }

  private async poll() {
    const config = getConfig();
    if (!config.API_KEY || !config.NODE_ID) {
        return; 
    }

    try {
      const response = await axios.get(`${config.CONTROLLER_URL}/commands/poll`, {
        headers: {
          'x-node-id': config.NODE_ID,
          'x-api-key': config.API_KEY
        }
      });

      if (response.data.hasCommand) {
        const command = response.data.command as CommandPayload;
        logger.info(`Received Command: ${command.type} (ID: ${command.id})`);
        await this.handleCommand(command);
      }
    } catch (error: any) {
        if (error.code !== 'ECONNREFUSED') {
            logger.warn('Polling error:', error.message);
        }
    }
  }

  private async handleCommand(command: CommandPayload) {
    const config = getConfig();
    let success = false;
    let resultData = null;

    try {
      switch (command.type) {
        case 'START_SERVER':
          const res = await this.dockerService.createGameServer(command.payload);
          logger.info(`Command ${command.type} executed successfully.`);
          
          // Notify controller that server is now LIVE
          // Ensure we use the correct database server ID from the payload
          const serverId = command.payload.id || command.payload.serverId;
          if (serverId) {
              try {
                  await axios.patch(`${config.CONTROLLER_URL}/servers/${serverId}`, {
                      status: 'LIVE'
                  }, {
                      headers: {
                          'x-node-id': config.NODE_ID,
                          'x-api-key': config.API_KEY
                      }
                  });
                  logger.info(`Server ${serverId} marked as LIVE.`);
              } catch (e: any) {
                  logger.warn(`Failed to set server LIVE for ${serverId}: ${e.message} (URL: ${config.CONTROLLER_URL}/servers/${serverId})`);
              }
          }

          resultData = res;
          success = true;
          break;

        case 'STOP_SERVER':
          await this.dockerService.stopContainer(command.payload.containerId);
          success = true;
          break;

        case 'LIST_FILES': {
          const rawPath = command.payload.path || '';
          // Sanitize: Force relative, remove leading slashes, reject '..'
          const safePath = rawPath.replace(/^\/+/, '').replace(/\.\./g, '');
          const targetPath = `/data/${safePath}`;
          
          resultData = await this.dockerService.listFiles(command.payload.serverId, targetPath);
          success = true;
          break;
        }

        case 'GET_FILE': {
          const rawPath = command.payload.path || '';
          const safePath = rawPath.replace(/^\/+/, '').replace(/\.\./g, '');
          const targetPath = `/data/${safePath}`;

          resultData = { content: await this.dockerService.getFileContent(command.payload.serverId, targetPath) };
          success = true;
          break;
        }

        case 'GET_LOGS':
          resultData = { content: await this.dockerService.getContainerLogs(command.payload.serverId) };
          success = true;
          break;

        case 'WRITE_FILE': {
          const rawPath = command.payload.path || '';
          const safePath = rawPath.replace(/^\/+/, '').replace(/\.\./g, '');
          const targetPath = `/data/${safePath}`;

          await this.dockerService.writeFileContent(command.payload.serverId, targetPath, command.payload.content);
          success = true;
          break;
        }

        case 'DELETE_FILE': {
          const rawPath = command.payload.path || '';
          const safePath = rawPath.replace(/^\/+/, '').replace(/\.\./g, '');
          const targetPath = `/data/${safePath}`;
          
          // Safety Check: Never delete root /data
          if (targetPath === '/data' || targetPath === '/data/') {
              throw new Error('Cannot delete root data directory');
          }

          await this.dockerService.deleteFile(command.payload.serverId, targetPath);
          success = true;
          break;
        }

        case 'EXEC_COMMAND':
          // Pipe directly to container stdin for real-time interaction
          await this.dockerService.sendCommand(command.payload.serverId, command.payload.command);
          success = true;
          break;

        case 'INJECT_ERROR':
          await this.dockerService.injectError(command.payload.serverId, command.payload.error);
          success = true;
          break;
        
        default:
          logger.warn(`Unknown command type: ${command.type}`);
          resultData = { error: 'Unknown command type' };
      }
    } catch (error: any) {
      logger.error(`Failed to execute command ${command.id}`, error);
      resultData = { error: error.message };
      success = false;
    }

    // Report back
    try {
      await axios.post(`${config.CONTROLLER_URL}/commands/${command.id}/complete`, {
        success,
        data: resultData
      }, {
        headers: {
          'x-node-id': config.NODE_ID,
          'x-api-key': config.API_KEY
        }
      });
    } catch (ackError) {
      logger.error('Failed to acknowledge command completion', ackError);
    }
  }
}
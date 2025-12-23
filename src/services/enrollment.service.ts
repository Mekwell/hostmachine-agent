import axios from 'axios';
import { getConfig, saveCredentials } from '../config';
import logger from '../logger';
import { MonitorService } from './monitor.service';

export class EnrollmentService {
  private monitorService: MonitorService;

  constructor() {
    this.monitorService = new MonitorService();
  }

  /**
   * Checks if the agent is already enrolled.
   * If not, attempts to register with the Controller.
   * Returns the Node ID if successful, null otherwise.
   */
  async enrollIfNeeded(): Promise<string | null> {
    const config = getConfig();

    if (config.API_KEY && config.NODE_ID) {
      logger.info(`Agent is already enrolled (NodeID: ${config.NODE_ID}).`);
      return config.NODE_ID; 
    }

    logger.info('Agent is NOT fully enrolled. Starting registration process...');
    
    try {
      // 1. Gather Specs
      const specs = await this.monitorService.getSpecs();
      
      // 2. Prepare Payload
      const payload = {
        enrollmentToken: config.ENROLLMENT_TOKEN,
        specs: {
          cpuCores: specs.cpuCores,
          totalMemoryMb: specs.totalMemoryMb,
          totalDiskGb: specs.totalDiskGb,
          osPlatform: specs.osPlatform,
          hostname: specs.hostname
        },
        vpnIp: config.VPN_IP,
        location: config.LOCATION
      };

      // 3. Send Request
      const url = `${config.CONTROLLER_URL}/nodes/register`;
      logger.info(`Sending registration request to: ${url}`);
      
      const response = await axios.post(url, payload);

      if (response.data.status === 'success') {
        logger.info('Registration Successful!');
        logger.info(`Node ID: ${response.data.nodeId}`);
        
        // 4. Save Credentials
        saveCredentials(response.data.apiKey, response.data.nodeId);
        return response.data.nodeId;
      } else {
        logger.error('Registration failed: Controller returned error.', response.data);
        return null;
      }

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
          logger.error(`Registration failed: Could not connect to Controller at ${config.CONTROLLER_URL}. Is it running?`);
      } else {
          logger.error('Registration failed with error:', error.message);
          if (error.response) {
              logger.error('Server response:', error.response.data);
          }
      }
      return null;
    }
  }
}

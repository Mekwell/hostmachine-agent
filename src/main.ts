import { getConfig } from './config';
import logger from './logger';
import { DockerService } from './services/docker.service';
import { MonitorService } from './services/monitor.service';
import { EnrollmentService } from './services/enrollment.service';
import { CommandPollerService } from './services/command-poller.service';
import { WatcherService } from './services/watcher.service';
import { LogStreamService } from './services/log-stream.service';
import axios from 'axios';

const main = async () => {
  const config = getConfig();
  logger.info('=================================');
  logger.info('   Hostmachine Agent Starting    ');
  logger.info('=================================');
  logger.debug('Configuration loaded:', config);

  // --- Service Initialization ---
  const dockerService = new DockerService();
  const monitorService = new MonitorService();
  const enrollmentService = new EnrollmentService();
  const commandPoller = new CommandPollerService(dockerService);
  const watcherService = new WatcherService(dockerService);
  const logStreamService = new LogStreamService(dockerService, watcherService);

  // --- Step 1: System Introspection (Who am I?) ---
  logger.info('Step 1: Analyzing Host Hardware...');
  try {
    const specs = await monitorService.getSpecs();
    logger.info(`Host Detected: ${specs.hostname} (${specs.osPlatform})`);
    logger.info(`Specs: ${specs.cpuCores} Cores | ${specs.totalMemoryMb} MB RAM | ${specs.totalDiskGb} GB Disk`);
  } catch (err) {
    logger.error('CRITICAL: Failed to analyze host hardware.', err);
    process.exit(1);
  }

  // --- Step 2: Docker Health Check ---
  logger.info('Step 2: Connecting to Docker Daemon...');
  const dockerHealth = await dockerService.getHealth();

  if (dockerHealth.status === 'ok') {
      logger.info(`Docker Daemon Connected! Version: ${dockerHealth.version}`);
      const containers = await dockerService.listContainers();
      logger.info(`Found ${containers.length} active containers.`);
  } else {
      logger.error('CRITICAL: Docker Daemon is not reachable.', dockerHealth.error);
  }

  // --- Step 3: Initial Resource Check ---
  logger.info('Step 3: Checking Baseline Resources...');
  const usage = await monitorService.getUsage();
  logger.info(`Current Load: CPU ${usage.cpuLoad}% | RAM Used ${usage.memoryUsedMb} MB | Disk Used ${usage.diskUsedGb} GB`);

  // --- Step 4: Enrollment / Handshake ---
  logger.info('Step 4: Contacting Fleet Controller...');
  const nodeId = await enrollmentService.enrollIfNeeded();

  if (!nodeId) {
    logger.error('CRITICAL: Failed to enroll with Controller. Retrying in 30 seconds...');
    process.exit(1);
  }

  logger.info(`Node Enrolled (ID: ${nodeId}).`);
  
  // --- Step 5: Start Command Loop ---
  logger.info('Step 5: Starting Command Poller & HostBot Watcher...');
  commandPoller.setNodeId(nodeId);
  commandPoller.startPolling();
  watcherService.startWatching();
  logStreamService.startAllStreams();

  // --- Step 6: Initial Curated Image Optimization ---
  const prePullImages = async () => {
      logger.info('Starting curated image synchronization...');
      try {
          const response = await axios.get(`${config.CONTROLLER_URL}/games`);
          const games = response.data;
          for (const game of games) {
              logger.info(`Pre-pulling optimization: ${game.dockerImage}`);
              dockerService.pullImage(game.dockerImage).catch(e => {
                  logger.warn(`Failed to pre-pull ${game.dockerImage}: ${e.message}`);
              });
          }
      } catch (err) {
          logger.warn('Failed to sync curated games for pre-pulling.');
      }
  };
  
  prePullImages();

  logger.info('Agent is Fully Operational.');
  
  // Refresh Log Streams every 30 seconds for new containers
  setInterval(() => {
      logStreamService.startAllStreams();
  }, 30000);

  // --- Step 6: Start Heartbeat ---
  const startHeartbeat = () => {
    setInterval(async () => {
        try {
            const usage = await monitorService.getUsage();
            const containerStats = await dockerService.getContainerStats();
            
            await axios.post(`${config.CONTROLLER_URL}/nodes/heartbeat`, {
                usage: {
                    ...usage,
                    containerStats // Inject live CPU/RAM per server
                }
            }, {
                headers: {
                    'x-node-id': nodeId,
                    'x-api-key': config.API_KEY
                }
            });
        } catch (error: any) {
            logger.warn('Heartbeat failed:', error.message);
        }
    }, 10000); // Every 10 seconds
  };

  startHeartbeat();
  
  // Keep process alive
  setInterval(() => {}, 10000);
};

main().catch(error => {
  logger.error('Agent crashed:', error);
  process.exit(1);
});

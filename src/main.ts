import { getConfig } from './config';
import logger from './logger';
import { DockerService } from './services/docker.service';
import { MonitorService } from './services/monitor.service';
import { EnrollmentService } from './services/enrollment.service';
import { CommandPollerService } from './services/command-poller.service';
import { WatcherService } from './services/watcher.service';
import { LogStreamService } from './services/log-stream.service';
import { StatsStreamService } from './services/stats-stream.service';
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
  const statsStreamService = new StatsStreamService(dockerService);

  // ... (Hardware analyze, Docker health, Baseline resources) ...

  // --- Step 5: Start Command Loop ---
  logger.info('Step 5: Starting Command Poller & HostBot Watcher...');
  commandPoller.setNodeId(nodeId);
  commandPoller.startPolling();
  watcherService.startWatching();
  logStreamService.startAllStreams();
  statsStreamService.startStreaming();

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
    }, 60000); // Reduced to 60s to prevent Controller overload
  };

  startHeartbeat();
  
  // Keep process alive
  setInterval(() => {}, 10000);
};

main().catch(error => {
  logger.error('Agent crashed:', error);
  process.exit(1);
});

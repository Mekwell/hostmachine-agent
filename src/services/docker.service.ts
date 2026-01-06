import Docker from 'dockerode';
import logger from '../logger';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { paths, getFirewallCommand, getCopyCommand, isWindows } from '../utils/system';
import { PreflightService } from './preflight.service';

const execAsync = promisify(exec);

export class DockerService {
  private docker: Docker;
  private preflight: PreflightService;
  private readonly SERVERS_ROOT = paths.serversRoot;
  private readonly CACHE_ROOT = paths.cacheRoot;

  constructor() {
    this.docker = new Docker();
    this.preflight = new PreflightService();
    if (!fs.existsSync(this.SERVERS_ROOT)) {
        fs.mkdirSync(this.SERVERS_ROOT, { recursive: true });
    }
    if (!fs.existsSync(this.CACHE_ROOT)) {
        fs.mkdirSync(this.CACHE_ROOT, { recursive: true });
    }
  }

  private async manageFirewall(port: number, action: 'allow' | 'delete allow') {
    try {
        if (!['allow', 'delete allow'].includes(action)) {
           throw new Error('Invalid firewall action');
        }
        if (isNaN(port) || port <= 0 || port > 65535) {
           throw new Error('Invalid port number');
        }
        logger.info(`Firewall: ${action} on port ${port}`);
        const cmd = getFirewallCommand(port, action);
        await execAsync(cmd);
    } catch (err: any) {
        logger.warn(`Firewall command failed: ${err.message}.`);
    }
  }

  async getHealth(): Promise<{ status: 'ok' | 'error'; version?: string; error?: any }> {
    try {
      const version = await this.docker.version();
      return { status: 'ok', version: version.Version };
    } catch (error) {
      return { status: 'error', error };
    }
  }

  async listContainers(all: boolean = false): Promise<Docker.ContainerInfo[]> {
    return await this.docker.listContainers({ all });
  }

  async pullImage(imageTag: string): Promise<void> {
    logger.info(`Pulling image: ${imageTag}`);
    return new Promise((resolve, reject) => {
      this.docker.pull(imageTag, (err: any, stream: any) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (err: any) => err ? reject(err) : resolve(), () => {});
      });
    });
  }

  /**
   * Fast-copies game files from master cache to server volume.
   */
  private async preseedServerFiles(gameType: string, targetDir: string) {
      const cachePath = path.join(this.CACHE_ROOT, gameType);
      if (fs.existsSync(cachePath)) {
          logger.info(`[Preload] Found cache for ${gameType}. Seeding ${targetDir}...`);
          try {
              const cmd = getCopyCommand(cachePath, targetDir);
              await execAsync(cmd);
              logger.info(`[Preload] Seeding complete for ${gameType}`);
          } catch (e: any) {
              logger.warn(`[Preload] Seeding failed: ${e.message}. Fallback to container download.`);
          }
      } else {
          logger.debug(`[Preload] No cache found for ${gameType}.`);
      }
  }

  async installMod(serverId: string, mod: any) {
      const serverDataDir = path.join(this.SERVERS_ROOT, serverId, 'data');
      const targetDir = path.join(serverDataDir, mod.installPath.replace(/^\//, '').replace(/\//g, path.sep)); 
      
      if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
      }

      const fileName = mod.fileName || mod.downloadUrl.split('/').pop().split('?')[0]; 
      const filePath = path.join(targetDir, fileName);

      logger.info(`[Mod] Installing ${mod.name} to ${filePath}`);
      
      try {
          if (isWindows) {
              // PowerShell alternative for wget
              await execAsync(`powershell.exe -Command "Invoke-WebRequest -Uri '${mod.downloadUrl}' -OutFile '${filePath}'"`);
          } else {
              await execAsync(`wget -q -O "${filePath}" "${mod.downloadUrl}"`);
          }
          logger.info(`[Mod] Download complete: ${mod.name}`);
      } catch (err: any) {
          logger.error(`[Mod] Failed to download ${mod.name}: ${err.message}`);
          throw err;
      }
  }

  async createGameServer(config: {
    serverId: string;
    image: string;
    port: number;
    internalPort: number;
    memoryLimitMb: number;
    env: string[];
    mods?: any[];
    bindIp?: string;
    forceRecreate?: boolean;
  }) {
    logger.info(`Creating Game Server ${config.serverId} on port ${config.port} (Bind: ${config.bindIp || '0.0.0.0'})`);

    try {
        const image = this.docker.getImage(config.image);
        await image.inspect();
    } catch (err: any) {
        if (err.statusCode === 404) {
            logger.info(`Image ${config.image} missing. Pulling...`);
            await this.pullImage(config.image);
        } else {
            throw err;
        }
    }

    const hostDataDir = path.join(this.SERVERS_ROOT, config.serverId, 'data');
    if (!fs.existsSync(hostDataDir)) {
        fs.mkdirSync(hostDataDir, { recursive: true });
        if (!isWindows) {
            await execAsync(`chmod -R 777 ${hostDataDir}`); 
        }
        
        // Trigger Preload if available
        const gameId = config.image.split(':').shift()?.split('/').pop()?.replace('game-', '');
        if (gameId) {
            await this.preseedServerFiles(gameId, hostDataDir);
        }
    }

    if (config.mods && config.mods.length > 0) {
        logger.info(`Hydrating ${config.mods.length} mods...`);
        for (const mod of config.mods) {
            await this.installMod(config.serverId, mod);
        }
    }

    try {
        // --- CONTAINER REUSE LOGIC ---
        let existingContainer = null;
        try {
            existingContainer = this.docker.getContainer(config.serverId);
            const info = await existingContainer.inspect();
            
            if (info.State.Running) {
                if (config.forceRecreate) {
                    logger.info(`Container ${config.serverId} is running. Stopping for RESTART...`);
                    await existingContainer.stop();
                    await existingContainer.remove(); 
                    existingContainer = null;
                } else {
                    logger.info(`Container ${config.serverId} is already running. Skipping start logic.`);
                    return { id: existingContainer.id, alreadyRunning: true };
                }
            } else {
                logger.info(`Found stopped container ${config.serverId}. Attempting to start...`);
                await existingContainer.start();
                logger.info(`Resumed existing container ${config.serverId}.`);
                
                // Re-apply firewall rules
                const queryPort = config.port + 1;
                const rconPort = config.port + 2;
                await this.manageFirewall(config.port, 'allow');
                await this.manageFirewall(queryPort, 'allow');
                await this.manageFirewall(rconPort, 'allow');
                
                return { id: existingContainer.id };
            }
        } catch (e) {
            // Container doesn't exist or error inspecting, proceed to create
        }

        if (existingContainer) {
            // If we reached here and container exists, it was stopped and we already started it or handled it.
            // But just in case, we continue to create if existingContainer was set to null.
        }

        const bindIp = config.bindIp || '0.0.0.0';
        const jvmArgs = this.preflight.calculateJvmArgs(config.mods?.length || 0, config.memoryLimitMb);
        
        const finalEnv = [
            ...config.env,
            `SERVER_ID=${config.serverId}`,
            `JVM_FLAGS=${jvmArgs.join(' ')}`
        ];

        const queryPort = config.port + 1;
        const rconPort = config.port + 2;

        const container = await this.docker.createContainer({
            Image: config.image,
            name: config.serverId,
            Env: finalEnv,
            Healthcheck: {
                Test: ["CMD-SHELL", "ls /data || exit 1"],
                Interval: 60000000000, // 60s
                Timeout: 30000000000, // 30s
                Retries: 3,
                StartPeriod: 300000000000 // 5m (Allow 5 mins for SteamCMD/VC++)
            },
            HostConfig: {
                PortBindings: {
                    [`${config.internalPort}/tcp`]: [{ HostPort: String(config.port), HostIp: bindIp }],
                    [`${config.internalPort}/udp`]: [{ HostPort: String(config.port), HostIp: bindIp }],
                    [`27015/udp`]: [{ HostPort: String(queryPort), HostIp: bindIp }],
                    [`27020/tcp`]: [{ HostPort: String(rconPort), HostIp: bindIp }]
                },
                Binds: [
                    `${hostDataDir}:/data`,
                    `${hostDataDir}:/home/container`,
                    `${hostDataDir}:/home/linuxgsm/serverfiles`
                ],
                Memory: config.memoryLimitMb * 1024 * 1024,
                PidsLimit: 2000,
                Dns: ['8.8.8.8', '1.1.1.1'], // Force Public DNS for VPN compatibility
            },
            ExposedPorts: {
                [`${config.internalPort}/tcp`]: {},
                [`${config.internalPort}/udp`]: {},
                [`27015/udp`]: {},
                [`27020/tcp`]: {}
            }
        });

        await container.start();
        logger.info(`Server ${config.serverId} started. Ports: Game=${config.port}, Query=${queryPort}, RCON=${rconPort}`);

        // Force Install Hook (Safe for all images, runs silently)
        if (!isWindows) {
            setTimeout(async () => {
                try {
                    const exec = await container.exec({ 
                        Cmd: ['/bin/bash', '-c', 'if [ -f ./terrariaserver ]; then ./terrariaserver install; fi'], 
                        AttachStdout: false, 
                        AttachStderr: false
                    });
                    await exec.start({});
                } catch (e) {}
            }, 5000);
        }

        await this.manageFirewall(config.port, 'allow');
        await this.manageFirewall(queryPort, 'allow');
        await this.manageFirewall(rconPort, 'allow');

        return { id: container.id };
    } catch (error) {
        logger.error(`Failed to create server ${config.serverId}`, error);
        throw error;
    }
  }

  async stopContainer(containerId: string, purge: boolean = false) {
      try {
          const container = this.docker.getContainer(containerId);
          
          if (purge) {
              logger.info(`Container ${containerId}: PURGING (Stop + Remove)...`);
              const info = await container.inspect();
              const portBindings = info.HostConfig.PortBindings;
              if (portBindings) {
                  for (const key in portBindings) {
                      const hostPorts = portBindings[key];
                      if (hostPorts && hostPorts.length > 0) {
                          const port = parseInt(hostPorts[0].HostPort);
                          if (port) await this.manageFirewall(port, 'delete allow');
                      }
                  }
              }
              await container.stop().catch(() => {});
              await container.remove().catch(() => {});
              logger.info(`Container ${containerId} purged.`);
              return;
          }

          logger.info(`Container ${containerId}: Soft-stopping game process...`);
          
          // Send SIGTERM to the runner/game process inside
          // This keeps the container ALIVE but stops the game.
          try {
              await this.execCommand(containerId, ['pkill', '-15', '-f', 'entrypoint.sh']);
              await this.execCommand(containerId, ['pkill', '-15', '-f', 'ShooterGame']);
              await this.execCommand(containerId, ['pkill', '-15', '-f', 'Minecraft']);
          } catch (e) {
              logger.warn(`Soft-stop signals sent, some may have failed if processes were already dead.`);
          }

          logger.info(`Container ${containerId} game processes signaled to stop. Container remains UP.`);
      } catch (error) {
          logger.error(`Failed to stop/purge container ${containerId}`, error);
          throw error;
      }
  }

  async execCommand(containerId: string, cmd: string[]) {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    return new Promise((resolve, reject) => {
        let output = '';
        stream.on('data', (chunk) => output += chunk.toString());
        stream.on('end', () => resolve(output));
        stream.on('error', (err) => reject(err));
    });
  }

  async listFiles(containerId: string, path: string) {
      const output = await this.execCommand(containerId, ['ls', '-p', '--block-size=1', '--time-style=long-iso', '-l', path]) as string;
      return output.split('\n').filter(l => l.trim() && !l.startsWith('total')).map(line => {
          const parts = line.trim().split(/\s+/);
          const isDir = parts[0].startsWith('d');
          return {
              name: parts.slice(7).join(' '),
              type: isDir ? 'directory' : 'file',
              size: parseInt(parts[4]) || 0,
              lastModified: `${parts[5]} ${parts[6]}`
          };
      });
  }

  async getFileContent(containerId: string, path: string) {
      return await this.execCommand(containerId, ['cat', path]);
  }

  async getContainerLogs(containerId: string) {
      const container = this.docker.getContainer(containerId);
      const logs = await container.logs({
          stdout: true,
          stderr: true,
          tail: 100,
          timestamps: false
      });
      return logs.toString('utf-8');
  }

  async sendCommand(containerId: string, command: string) {
      const container = this.docker.getContainer(containerId);
      // We use attach to get the stdin stream
      const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false });
      stream.write(command + '\n');
      stream.end();
      logger.info(`[Console] Sent command to ${containerId}: ${command}`);
  }

  async injectError(containerId: string, error: string) {
      logger.info(`[Chaos] Injecting error keyword into ${containerId}: ${error}`);
      // Write directly to the container's stdout/stderr log stream
      await this.execCommand(containerId, ['sh', '-c', `echo "${error}"`]);
  }

  async getContainerStats() {
      const stats: Record<string, { cpu: number, ram: number, players: any[] }> = {};
      try {
          const containers = await this.docker.listContainers();
          
          for (const c of containers) {
              try {
                  const container = this.docker.getContainer(c.Id);
                  const s = await container.stats({ stream: false });
                  
                  // Calculate CPU %
                  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
                  const systemDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
                  const cpuPercent = (cpuDelta / systemDelta) * s.cpu_stats.online_cpus * 100;

                  // Attempt to fetch players from sidecar runner via HTTP (internal)
                  // Sidecar runner listens on port 3001 inside the container
                  let players = [];
                  try {
                      // We use the container name as ID
                      const serverId = c.Names[0].replace('/', '');
                      const playersOutput = await this.execCommand(c.Id, ['curl', '-s', 'http://localhost:3001/players']);
                      players = JSON.parse(playersOutput as string);
                  } catch (e) {
                      // Sidecar might not be ready or unsupported for this game
                  }

                  stats[c.Names[0].replace('/', '')] = {
                      cpu: Math.round(cpuPercent) || 0,
                      ram: Math.round(s.memory_stats.usage / 1024 / 1024) || 0,
                      players: players || []
                  };
              } catch (err) {
                  logger.warn(`Failed to fetch stats for ${c.Id}`);
              }
          }
      } catch (e) {
          logger.debug('Docker not reachable during stats scan.');
      }
      return stats;
  }

  async writeFileContent(containerId: string, path: string, content: string) {
      return new Promise<void>((resolve, reject) => {
          // Use docker exec with stdin (-i) to pipe content safely
          const child = spawn('docker', ['exec', '-i', containerId, 'sh', '-c', `cat > "${path}"`]);

          child.stdin.write(content);
          child.stdin.end();

          child.on('close', (code) => {
              if (code === 0) {
                  resolve();
              } else {
                  reject(new Error(`Failed to write file (Exit Code: ${code})`));
              }
          });
          
          child.on('error', (err) => reject(err));
      });
  }

  async deleteFile(containerId: string, path: string) {
      logger.info(`Deleting file in ${containerId}: ${path}`);
      return await this.execCommand(containerId, ['rm', '-rf', path]);
  }

  async installModpack(serverId: string, config: { downloadUrl: string, packName: string }) {
      const serverDataDir = path.join(this.SERVERS_ROOT, serverId, 'data');
      const modsDir = path.join(serverDataDir, 'mods');
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

      const tempZip = path.join(serverDataDir, 'modpack_temp.zip');
      logger.info(`[Modpack] Downloading ${config.packName} to ${tempZip}`);

      try {
          if (isWindows) {
              await execAsync(`powershell.exe -Command "Invoke-WebRequest -Uri '${config.downloadUrl}' -OutFile '${tempZip}'"`);
              await execAsync(`powershell.exe -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${modsDir}' -Force"`);
          } else {
              await execAsync(`wget -q -O "${tempZip}" "${config.downloadUrl}"`);
              await execAsync(`unzip -o "${tempZip}" -d "${modsDir}"`);
          }
          fs.unlinkSync(tempZip);
          logger.info(`[Modpack] ${config.packName} installed successfully.`);
      } catch (err: any) {
          logger.error(`[Modpack] Installation failed: ${err.message}`);
          throw err;
      }
  }

  async createArchive(containerId: string, sourcePath: string, archiveName: string) {
      logger.info(`Creating archive ${archiveName} for ${containerId}`);
      // Using tar for reliability across linux containers
      await this.execCommand(containerId, ['tar', '-czf', `/data/${archiveName}`, '-C', sourcePath, '.']);
      return { path: `/data/${archiveName}` };
  }

  async extractArchive(containerId: string, archivePath: string, targetPath: string) {
      logger.info(`Extracting archive ${archivePath} for ${containerId}`);
      await this.execCommand(containerId, ['mkdir', '-p', targetPath]);
      await this.execCommand(containerId, ['tar', '-xzf', archivePath, '-C', targetPath]);
      return { status: 'success' };
  }
}

import Docker from 'dockerode';
import logger from '../logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export class DockerService {
  private docker: Docker;
  private readonly SERVERS_ROOT = '/opt/hostmachine/servers';
  private readonly CACHE_ROOT = '/opt/hostmachine/cache';

  constructor() {
    this.docker = new Docker();
    if (!fs.existsSync(this.SERVERS_ROOT)) {
        fs.mkdirSync(this.SERVERS_ROOT, { recursive: true });
    }
    if (!fs.existsSync(this.CACHE_ROOT)) {
        fs.mkdirSync(this.CACHE_ROOT, { recursive: true });
    }
  }

  private async manageFirewall(port: number, action: 'allow' | 'delete allow') {
    try {
        logger.info(`Firewall: ${action} on port ${port}`);
        await execAsync(`sudo ufw ${action} ${port}/tcp`);
        await execAsync(`sudo ufw ${action} ${port}/udp`);
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
              // Note: Using a robust copy command
              await execAsync(`cp -r ${cachePath}/* ${targetDir}/`);
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
      const targetDir = path.join(serverDataDir, mod.installPath.replace(/^\//, '')); 
      
      if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
      }

      const fileName = mod.fileName || mod.downloadUrl.split('/').pop().split('?')[0]; 
      const filePath = path.join(targetDir, fileName);

      logger.info(`[Mod] Installing ${mod.name} to ${filePath}`);
      
      try {
          await execAsync(`wget -q -O "${filePath}" "${mod.downloadUrl}"`);
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
        await execAsync(`chmod -R 777 ${hostDataDir}`); 
        
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
        const bindIp = config.bindIp || '0.0.0.0';
        const container = await this.docker.createContainer({
            Image: config.image,
            name: config.serverId,
            Env: config.env,
            HostConfig: {
                PortBindings: {
                    [`${config.internalPort}/tcp`]: [{ HostPort: String(config.port), HostIp: bindIp }],
                    [`${config.internalPort}/udp`]: [{ HostPort: String(config.port), HostIp: bindIp }]
                },
                Binds: [
                    `${hostDataDir}:/data`,
                    `${hostDataDir}:/home/container`,
                    `${hostDataDir}:/home/linuxgsm/serverfiles`
                ],
                Memory: config.memoryLimitMb * 1024 * 1024,
                PidsLimit: 100,
            },
            ExposedPorts: {
                [`${config.internalPort}/tcp`]: {},
                [`${config.internalPort}/udp`]: {}
            }
        });

        await container.start();
        logger.info(`Server ${config.serverId} started.`);

        // Force Install Hook (Safe for all images, runs silently)
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

        await this.manageFirewall(config.port, 'allow');

        return { id: container.id };
    } catch (error) {
        logger.error(`Failed to create server ${config.serverId}`, error);
        throw error;
    }
  }

  async stopContainer(containerId: string) {
      try {
          const container = this.docker.getContainer(containerId);
          const info = await container.inspect();
          const portBindings = info.HostConfig.PortBindings;
          if (portBindings) {
              for (const key in portBindings) {
                  const port = parseInt(portBindings[key][0].HostPort);
                  if (port) await this.manageFirewall(port, 'delete allow');
              }
          }
          await container.stop();
          logger.info(`Container ${containerId} stopped.`);
      } catch (error) {
          logger.error(`Failed to stop container ${containerId}`, error);
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

  async getContainerStats() {
      const containers = await this.docker.listContainers();
      const stats: Record<string, { cpu: number, ram: number }> = {};
      
      for (const c of containers) {
          const container = this.docker.getContainer(c.Id);
          const s = await container.stats({ stream: false });
          
          // Calculate CPU %
          const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
          const systemDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
          const cpuPercent = (cpuDelta / systemDelta) * s.cpu_stats.online_cpus * 100;

          stats[c.Names[0].replace('/', '')] = {
              cpu: Math.round(cpuPercent) || 0,
              ram: Math.round(s.memory_stats.usage / 1024 / 1024) || 0
          };
      }
      return stats;
  }

  async writeFileContent(containerId: string, path: string, content: string) {
      const escaped = content.replace(/"/g, '\\"');
      return await this.execCommand(containerId, ['sh', '-c', `echo "${escaped}" > "${path}"`]);
  }

  async deleteFile(containerId: string, path: string) {
      logger.info(`Deleting file in ${containerId}: ${path}`);
      return await this.execCommand(containerId, ['rm', '-rf', path]);
  }
}

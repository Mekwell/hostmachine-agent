import si from 'systeminformation';
import logger from '../logger';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';

const execAsync = promisify(exec);
const docker = new Docker();

export interface NodeSpecs {
  cpuCores: number;
  totalMemoryMb: number;
  totalDiskGb: number;
  osPlatform: string;
  hostname: string;
}

export interface NodeUsage {
  cpuLoad: number;
  memoryUsedMb: number;
  memoryFreeMb: number;
  diskUsedGb: number;
  publicIp?: string;
  vpnIp?: string;
  containers?: string[];
  containerStates?: Record<string, 'RUNNING' | 'LIVE' | 'STARTING'>; 
}

export class MonitorService {
  
  async getPublicIp(): Promise<string> {
    try {
        const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        return response.data.ip;
    } catch (err) {
        const net = await si.networkInterfaces();
        const def = net.find(i => i.default);
        return def?.ip4 || '127.0.0.1';
    }
  }

  async getVpnIp(): Promise<string | undefined> {
      try {
          const interfaces = await si.networkInterfaces();
          const vpnIface = interfaces.find(i => i.iface === 'wg0' || i.iface.startsWith('wg'));
          return vpnIface?.ip4;
      } catch (e) {
          return undefined;
      }
  }

  async getUsage(): Promise<NodeUsage> {
    try {
      const load = await si.currentLoad();
      const mem = await si.mem();
      const disk = await si.fsSize();
      const rootDisk = disk.find(d => d.mount === '/') || disk[0];
      const publicIp = await this.getPublicIp();
      const vpnIp = await this.getVpnIp();
      
      // 1. Get all running containers and their port mappings
      const containers = await docker.listContainers();
      const containerStates: Record<string, 'RUNNING' | 'LIVE' | 'STARTING'> = {};
      const activePorts: number[] = [];

      // Get all listening UDP/TCP ports on the host
      try {
          const { stdout: netstat } = await execAsync("sudo ss -tuln | awk '{print $5}' | grep -oE '[0-9]+'$");
          netstat.split('\n').forEach(p => {
              const port = parseInt(p.trim());
              if (port) activePorts.push(port);
          });
      } catch (e) {
          logger.warn('Failed to fetch netstat data');
      }

      for (const c of containers) {
          const name = c.Names[0].replace('/', '');
          // Default to STARTING (Container is up, but engine might not be)
          containerStates[name] = 'STARTING';

          // Check if any of the mapped public ports are actually listening in netstat
          const hasListeningPort = c.Ports.some(p => activePorts.includes(p.PublicPort));
          
          if (hasListeningPort) {
              containerStates[name] = 'LIVE';
          } else {
              // If container has been up for more than 5 minutes and no port, mark as RUNNING (Generic)
              const uptimeSeconds = (Date.now() / 1000) - c.Created;
              if (uptimeSeconds > 300) {
                  containerStates[name] = 'RUNNING';
              }
          }
      }

      return {
        cpuLoad: Math.round(load.currentLoad),
        memoryUsedMb: Math.floor(mem.active / 1024 / 1024),
        memoryFreeMb: Math.floor(mem.available / 1024 / 1024),
        diskUsedGb: rootDisk ? Math.floor(rootDisk.used / 1024 / 1024 / 1024) : 0,
        publicIp,
        vpnIp,
        containers: Object.keys(containerStates),
        containerStates
      };
    } catch (error) {
      logger.error('Failed to retrieve system usage', error);
      throw error;
    }
  }

  async getSpecs(): Promise<NodeSpecs> {
      const cpu = await si.cpu();
      const mem = await si.mem();
      const os = await si.osInfo();
      const disk = await si.fsSize();
      const rootDisk = disk.find(d => d.mount === '/') || disk[0];

      return {
        cpuCores: cpu.physicalCores,
        totalMemoryMb: Math.floor(mem.total / 1024 / 1024),
        totalDiskGb: Math.floor((rootDisk?.size || 0) / 1024 / 1024 / 1024),
        osPlatform: `${os.distro} ${os.release}`,
        hostname: os.hostname,
      };
  }
}
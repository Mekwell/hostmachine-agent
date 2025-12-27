import * as os from 'os';
import * as path from 'path';

export const isWindows = os.platform() === 'win32';

export interface SystemPaths {
    serversRoot: string;
    cacheRoot: string;
}

export const paths: SystemPaths = isWindows ? {
    serversRoot: path.join(process.env.ProgramData || 'C:\\ProgramData', 'hostmachine', 'servers'),
    cacheRoot: path.join(process.env.ProgramData || 'C:\\ProgramData', 'hostmachine', 'cache'),
} : {
    serversRoot: '/opt/hostmachine/servers',
    cacheRoot: '/opt/hostmachine/cache',
};

export function getFirewallCommand(port: number, action: 'allow' | 'delete allow'): string {
    if (isWindows) {
        if (action === 'allow') {
            return `powershell.exe -Command "New-NetFirewallRule -DisplayName 'HostMachine Port ${port}' -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow; New-NetFirewallRule -DisplayName 'HostMachine Port ${port} UDP' -Direction Inbound -LocalPort ${port} -Protocol UDP -Action Allow"`;
        } else {
            return `powershell.exe -Command "Remove-NetFirewallRule -DisplayName 'HostMachine Port ${port}*'"`;
        }
    } else {
        return `sudo ufw ${action} ${port}`;
    }
}

export function getCopyCommand(source: string, target: string): string {
    if (isWindows) {
        return `xcopy /E /I /Y "${source}" "${target}"`;
    } else {
        return `cp -r ${source}/* ${target}/`;
    }
}

export function getNetstatCommand(): string {
    if (isWindows) {
        return `netstat -ano`;
    } else {
        return `sudo ss -tuln`;
    }
}

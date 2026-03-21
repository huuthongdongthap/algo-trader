// Barrel export for scaling module
export { InstanceManager } from './instance-manager.js';
export type { InstanceConfig, InstanceStatus } from './instance-manager.js';

export { ProcessMonitor } from './process-monitor.js';
export type { ProcessHealth, HealthReport } from './process-monitor.js';

export { getDeployConfig, validateDeployConfig } from './deploy-config.js';
export type { DeployEnvironment, DeployConfig } from './deploy-config.js';

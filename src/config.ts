import { z } from 'zod';
import dotenv from 'dotenv';
import logger from './logger';
import fs from 'fs';
import path from 'path';

dotenv.config(); // Load .env file

const CREDENTIALS_PATH = path.resolve(process.cwd(), 'credentials.json');

const configSchema = z.object({
  CONTROLLER_URL: z.string().url().default('http://localhost:3000'), // Default to local for dev
  NODE_NAME: z.string().optional(),
  ENROLLMENT_TOKEN: z.string().default('valid-token'), // Hardcoded for prototype
  VPN_IP: z.string().ip().optional(),
  LOCATION: z.string().default('Australia'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_KEY: z.string().optional(), // Loaded from credentials.json
  NODE_ID: z.string().optional(), // Loaded from credentials.json
});

export type AgentConfig = z.infer<typeof configSchema>;

let config: AgentConfig;

// Helper to load persisted credentials
const loadCredentials = (): { apiKey?: string, nodeId?: string } => {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const data = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.warn('Failed to load credentials file', err);
  }
  return {};
};

export const saveCredentials = (apiKey: string, nodeId: string) => {
  try {
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ apiKey, nodeId }, null, 2));
    logger.info(`Credentials saved to ${CREDENTIALS_PATH}`);
    // Update runtime config
    if (config) {
        config.API_KEY = apiKey;
        config.NODE_ID = nodeId;
    }
  } catch (err) {
    logger.error('Failed to save credentials file', err);
  }
};

export const loadConfig = (): AgentConfig => {
  if (config) return config;

  const credentials = loadCredentials();
  const envConfig = configSchema.safeParse({ 
    ...process.env, 
    API_KEY: credentials.apiKey,
    NODE_ID: credentials.nodeId 
  });

  if (envConfig.success) {
    config = envConfig.data;
    logger.info('Configuration loaded.');
    return config;
  } else {
    logger.warn('Using default configuration due to environment errors.');
    config = configSchema.parse({ 
        API_KEY: credentials.apiKey,
        NODE_ID: credentials.nodeId
    });
    // Merge partials
    const partialConfig = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key in configSchema.shape)
    );
    config = { ...config, ...partialConfig };
    return config;
  }
};

export const getConfig = (): AgentConfig => {
  if (!config) return loadConfig();
  return config;
};

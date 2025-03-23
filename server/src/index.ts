import express, { Request, Response } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import error2json from 'error-to-json';

interface Config {
  homebridge: {
    url: string;
    username: string;
    password: string;
  };
  port: number;
  lightGroups: {
    [key: string]: string[];
  };
}

const app = express();
let config!: Config; // Используем оператор уверенности
let token = '';

// Load configuration
function loadConfig() {
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error(
      '🔴 Config file is missing. Please run the configuration script.'
    );
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// Migrate old .env to config.json
function migrateEnv() {
  const envPath = path.join(__dirname, '../.env');
  const configPath = path.join(__dirname, '../config.json');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    const oldConfig: Config = {
      homebridge: {
        url: process.env.HOMEBRIDGE_URL || 'http://localhost',
        username: process.env.HOMEBRIDGE_USERNAME || '',
        password: process.env.HOMEBRIDGE_PASSWORD || ''
      },
      port: parseInt(process.env.PORT || '2322', 10),
      lightGroups: {
        '1': (process.env.HOMEBRIDGE_UUIDS || '').split(',')
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2));
    fs.unlinkSync(envPath);
    console.log('🔄 Configuration migrated from .env to config.json');
  }
}

// Refresh authentication token
async function refreshToken(): Promise<void> {
  try {
    const response = await axios.post(
      `${config.homebridge.url}/api/auth/login`,
      {
        username: config.homebridge.username,
        password: config.homebridge.password
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    token = response.data.access_token;
    //tokenExpiration = Date.now() + (response.data.expires_in - 300) * 1000;

    await axios.get(`${config.homebridge.url}/api/accessories`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('🔐 Token refreshed successfully');
  } catch (error: any) {
    console.error('❌ Failed to refresh token', error.message);
  }
}

setInterval(() => {
  refreshToken();
}, 30000);

// Control lamps in a light group
async function controlLightGroup(
  groupId: string,
  value: boolean
): Promise<string[]> {
  const uuids = config.lightGroups[groupId];
  if (!uuids) {
    throw new Error(`Light group with ID ${groupId} does not exist`);
  }
  const results = await Promise.all(
    uuids.map(async (uuid) => {
      try {
        await axios.put(
          `${config.homebridge.url}/api/accessories/${uuid}`,
          {
            characteristicType: 'On',
            value
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(
          `💡 Lamp with UUID ${uuid} turned ${value ? 'on' : 'off'} successfully`
        );
        return `Lamp with UUID ${uuid} turned ${value ? 'on' : 'off'} successfully`;
      } catch (error: any) {
        console.error(
          `❌ Failed to control lamp with UUID ${uuid}`,
          error.message
        );
        return `Failed to control lamp with UUID ${uuid}: ${JSON.stringify(error2json(error))}`;
      }
    })
  );
  return results;
}

// Load configuration and migrate env before using config
loadConfig();
migrateEnv();

// Start server
async function startServer() {
  await refreshToken();
  app.listen(config.port, () => {
    console.log(
      `🚀 Foxy Switch API listening at http://localhost:${config.port}`
    );
  });
}

startServer();

// List available light groups
app.get('/lightgroups', (req: Request, res: Response): void => {
  res.json({
    message: '💡 Available light groups',
    lightGroups: config.lightGroups
  });
});

// Turn on a light group
app.get('/switch/on', async (req: Request, res: Response): Promise<void> => {
  const groupId = req.query.switch as string;
  if (!groupId) {
    res.status(400).json({
      error: 'Missing switch parameter'
    });
    return;
  }
  try {
    const results = await controlLightGroup(groupId, true);
    res.json({
      message: `🟢 Light group ${groupId} turned on`,
      details: results
    });
  } catch (error: any) {
    console.error(error);
    res.status(400).json({
      error: error.message
    });
  }
});

// Turn off a light group
app.get('/switch/off', async (req: Request, res: Response): Promise<void> => {
  const groupId = req.query.switch as string;
  if (!groupId) {
    res.status(400).json({
      error: 'Missing switch parameter'
    });
    return;
  }
  try {
    const results = await controlLightGroup(groupId, false);
    res.json({
      message: `🔴 Light group ${groupId} turned off`,
      details: results
    });
  } catch (error: any) {
    console.error(error);
    res.status(400).json({
      error: error.message
    });
  }
});

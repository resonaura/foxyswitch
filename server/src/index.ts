import Fastify from 'fastify';
import axios, { AxiosInstance, AxiosHeaders } from 'axios';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

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

const app = Fastify({ logger: true, ignoreTrailingSlash: true });
let config!: Config;
let token = '';

/** Как часто «греть» аксессуары (мс) */
const WARMUP_EVERY_MS = 60_000;
/** Раз в сколько обновлять токен (мс) */
const REFRESH_TOKEN_EVERY_MS = 30_000;
/** Время последнего успешного прогрева */
let lastWarmupAt = 0;

/** Быстрые keep-alive агенты для максимальной скорости до Homebridge */
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 15_000,
  keepAliveMsecs: 10_000
});
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 15_000,
  keepAliveMsecs: 10_000
});

/** Единый axios-клиент для Homebridge */
let hb!: AxiosInstance;

/** Универсальный JSON для ошибок (лучше, чем сторонний пакет) */
function errToJSON(err: any) {
  if (axios.isAxiosError(err)) {
    return {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      statusText: err.response?.statusText,
      url: err.config?.url,
      method: err.config?.method,
      data: err.response?.data
    };
  }
  return {
    message: err?.message ?? String(err),
    stack: err?.stack
  };
}

/** Хелпер для установки/переустановки клиента после загрузки конфига/токена */
function initHttpClient() {
  hb = axios.create({
    baseURL: config.homebridge.url.replace(/\/+$/, ''), // без хвостового /
    timeout: 7_000,
    httpAgent,
    httpsAgent,
    transitional: { clarifyTimeoutError: true }
  });

  // Интерсептор: автоматом подставляем токен в корректный тип заголовков
  hb.interceptors.request.use((req) => {
    const headers =
      req.headers instanceof AxiosHeaders
        ? req.headers
        : new AxiosHeaders(req.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
    req.headers = headers;
    return req;
  });
}

// Load configuration
function loadConfig() {
  const configPath = path.join(import.meta.dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error(
      '🔴 Config file is missing. Please run the configuration script.'
    );
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  initHttpClient();
}

// Migrate old .env to config.json
function migrateEnv() {
  const envPath = path.join(import.meta.dirname, '../.env');
  const configPath = path.join(import.meta.dirname, '../config.json');
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
        '1': (process.env.HOMEBRIDGE_UUIDS || '').split(',').filter(Boolean)
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2));
    fs.unlinkSync(envPath);
    console.log('🔄 Configuration migrated from .env to config.json');
    // Перечитаем актуальный config
    loadConfig();
  }
}

/** Прогрев аксессуаров: дёргаем список, чтобы Homebridge «прозрел» UUID */
async function warmUpAccessories(): Promise<void> {
  if (!token) return;
  try {
    const resp = await hb.get('/api/accessories');
    lastWarmupAt = Date.now();
    const count = Array.isArray(resp.data) ? resp.data.length : 0;
    app.log.info({ count }, '🔥 Accessories warmed');
  } catch (error: any) {
    app.log.warn({ err: errToJSON(error) }, '⚠️ Warmup failed');
  }
}

/** Убедиться, что прогрев был недавно */
async function ensureWarmed(): Promise<void> {
  const tooOld = Date.now() - lastWarmupAt > WARMUP_EVERY_MS;
  if (tooOld) {
    await warmUpAccessories();
  }
}

// Refresh authentication token
async function refreshToken(): Promise<void> {
  try {
    const resp = await axios.post(
      `${config.homebridge.url.replace(/\/+$/, '')}/api/auth/login`,
      {
        username: config.homebridge.username,
        password: config.homebridge.password
      },
      {
        headers: { 'Content-Type': 'application/json' },
        httpAgent,
        httpsAgent,
        timeout: 7_000
      }
    );
    token = resp.data.access_token;
    app.log.info('🔐 Token refreshed successfully');

    // После логина сразу «прогреем» аксессуары
    await warmUpAccessories();
  } catch (error: any) {
    app.log.error({ err: errToJSON(error) }, '❌ Failed to refresh token');
  }
}

setInterval(() => {
  refreshToken();
}, REFRESH_TOKEN_EVERY_MS);

// Доп. регулярный прогрев независимо от обновления токена
setInterval(() => {
  warmUpAccessories();
}, WARMUP_EVERY_MS);

// Control lamps in a light group
async function controlLightGroup(
  groupId: string,
  value: boolean
): Promise<string[]> {
  const uuids = config.lightGroups[groupId];
  if (!uuids) {
    throw new Error(`Light group with ID ${groupId} does not exist`);
  }

  // Перед управлением — гарантируем тёплое состояние
  await ensureWarmed();

  const results = await Promise.all(
    uuids.map(async (uuid) => {
      const url = `/api/accessories/${encodeURIComponent(uuid)}`;
      try {
        await hb.put(url, { characteristicType: 'On', value });

        const msg = `Lamp with UUID ${uuid} turned ${value ? 'on' : 'off'} successfully`;
        app.log.info(msg);
        return msg;
      } catch (err1: any) {
        // Если Homebridge «подзабыл» аксессуар (редко), сделаем быстрый warmup+повтор
        const status = err1?.response?.status;
        if (status === 404 || status === 400) {
          await warmUpAccessories();
          try {
            await hb.put(url, { characteristicType: 'On', value });
            const msg = `Lamp with UUID ${uuid} turned ${value ? 'on' : 'off'} successfully (after warmup retry)`;
            app.log.info(msg);
            return msg;
          } catch (err2: any) {
            app.log.error(
              { err: errToJSON(err2), uuid },
              '❌ Failed to control lamp after retry'
            );
            return `Failed to control lamp with UUID ${uuid}: ${JSON.stringify(errToJSON(err2))}`;
          }
        }

        app.log.error(
          { err: errToJSON(err1), uuid },
          '❌ Failed to control lamp'
        );
        return `Failed to control lamp with UUID ${uuid}: ${JSON.stringify(errToJSON(err1))}`;
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
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(
      `🚀 Foxy Switch API listening at http://localhost:${config.port}`
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

startServer();

/** Маршруты (аналогичные Express-версиям) */

// List available light groups
app.get('/lightgroups', async (_req, reply): Promise<void> => {
  reply.send({
    message: '💡 Available light groups',
    lightGroups: config.lightGroups
  });
});

// Turn on a light group
app.get('/switch/on', async (req, reply): Promise<void> => {
  const groupId = (req.query as any).switch as string;
  if (!groupId) {
    reply.code(400).send({ error: 'Missing switch parameter' });
    return;
  }
  try {
    const results = await controlLightGroup(groupId, true);
    reply.send({
      message: `🟢 Light group ${groupId} turned on`,
      details: results
    });
  } catch (error: any) {
    app.log.error(error);
    reply.code(400).send({ error: error.message });
  }
});

// Turn off a light group
app.get('/switch/off', async (req, reply): Promise<void> => {
  const groupId = (req.query as any).switch as string;
  if (!groupId) {
    reply.code(400).send({ error: 'Missing switch parameter' });
    return;
  }
  try {
    const results = await controlLightGroup(groupId, false);
    reply.send({
      message: `🔴 Light group ${groupId} turned off`,
      details: results
    });
  } catch (error: any) {
    app.log.error(error);
    reply.code(400).send({ error: error.message });
  }
});

import Fastify from 'fastify';
import axios, { AxiosInstance, AxiosHeaders } from 'axios';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';
import { io, Socket } from 'socket.io-client';

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

/** Настройки */
const WARMUP_EVERY_MS = 60_000; // как часто «греть» аксессуары
const REFRESH_TOKEN_EVERY_MS = 120_000; // как часто обновлять токен
const WS_READY_TIMEOUT_MS = 3_000; // сколько ждать ready после коннекта

/** Маркеры времени */
let lastWarmupAt = 0;

/** Быстрые keep-alive агенты */
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

/** Единый axios-клиент до Homebridge */
let hb!: AxiosInstance;

/** Socket.IO — только для прогрева (/accessories) */
let ws: Socket | null = null;
let wsReadyForControl = false;

/** Универсальный JSON для ошибок */
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
  return { message: err?.message ?? String(err), stack: err?.stack };
}

/** Хелпер для установки/переустановки axios-клиента */
function initHttpClient() {
  hb = axios.create({
    baseURL: config.homebridge.url.replace(/\/+$/, ''),
    timeout: 7_000,
    httpAgent,
    httpsAgent,
    transitional: { clarifyTimeoutError: true }
  });

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

/** Коннект к Socket.IO неймспейсу /accessories (прогрев) */
async function connectWs(): Promise<void> {
  if (!token) return;

  try {
    ws?.close();
  } catch {}

  const base = config.homebridge.url.replace(/\/+$/, '');
  wsReadyForControl = false;

  ws = io(`${base}/accessories`, {
    path: '/socket.io',
    transports: ['websocket'],
    query: { token }, // токен в query, как делает UI
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionAttempts: Infinity,
    timeout: 10_000
  });

  ws.on('connect', () => {
    ws?.emit('get-layout', { user: 'admin' });
    ws?.emit('get-accessories');
    app.log.info('🧦 WS connected, requested layout + accessories');
  });

  ws.on('accessories-data', () => {
    // сам факт прихода батчей «будит» HB
    lastWarmupAt = Date.now();
  });

  ws.on('accessories-ready-for-control', () => {
    wsReadyForControl = true;
    lastWarmupAt = Date.now();
    app.log.info('✅ WS accessories-ready-for-control');
  });

  ws.on('disconnect', (reason) => {
    wsReadyForControl = false;
    app.log.warn({ reason }, '⚠️ WS disconnected');
  });

  ws.on('connect_error', (e) => {
    wsReadyForControl = false;
    app.log.warn({ err: errToJSON(e) }, '⚠️ WS connect_error');
  });
}

/** Короткий «сеанс прогрева» (если вдруг сокет не держим) */
async function warmupOnceViaWs(): Promise<void> {
  if (!token) return;
  await connectWs();
  const start = Date.now();
  while (!wsReadyForControl && Date.now() - start < WS_READY_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Перманентный прогрев — держим сокет постоянно */
async function keepWarmWs(): Promise<void> {
  if (!token) await refreshToken();
  await connectWs();
}

/** Доп. REST-прогрев как «страховка» */
async function warmUpAccessories(): Promise<void> {
  if (!token) return;
  try {
    const resp = await hb.get('/api/accessories');
    lastWarmupAt = Date.now();
    const count = Array.isArray(resp.data) ? resp.data.length : 0;
    app.log.info({ count }, '🔥 Accessories warmed (REST)');
  } catch (error: any) {
    app.log.warn({ err: errToJSON(error) }, '⚠️ Warmup failed (REST)');
  }
}

/** Убедиться, что прогрев был недавно (WS в приоритете) */
async function ensureWarmed(): Promise<void> {
  const tooOld = Date.now() - lastWarmupAt > WARMUP_EVERY_MS;
  if (!ws || !ws.connected || !wsReadyForControl || tooOld) {
    await warmupOnceViaWs();
    if (!wsReadyForControl) {
      await warmUpAccessories();
    }
  }
}

/** Обновление токена */
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

    // после логина — переподнимем WS и подогреем
    await keepWarmWs();
  } catch (error: any) {
    app.log.error({ err: errToJSON(error) }, '❌ Failed to refresh token');
  }
}

/** Плановые задачи */
setInterval(() => {
  refreshToken();
}, REFRESH_TOKEN_EVERY_MS);
// Доп. REST-прогрев как «страховка»
setInterval(() => {
  warmUpAccessories();
}, WARMUP_EVERY_MS);

/** Управление группой света — ТОЛЬКО REST */
async function controlLightGroup(
  groupId: string,
  value: boolean
): Promise<string[]> {
  const uuids = config.lightGroups[groupId];
  if (!uuids) throw new Error(`Light group with ID ${groupId} does not exist`);

  // перед управлением — гарантируем тёплое состояние
  await ensureWarmed();

  const results = await Promise.all(
    uuids.map(async (uuid) => {
      const url = `/api/accessories/${encodeURIComponent(uuid)}`;
      try {
        await hb.put(url, { characteristicType: 'On', value });
        const msg = `Lamp ${uuid} set ${value ? 'on' : 'off'} via REST`;
        app.log.info(msg);
        return msg;
      } catch (err1: any) {
        const status = err1?.response?.status;
        if (status === 404 || status === 400) {
          // быстрый прогрев + повтор
          await warmupOnceViaWs();
          try {
            await hb.put(url, { characteristicType: 'On', value });
            const msg = `Lamp ${uuid} set ${value ? 'on' : 'off'} via REST (after warmup)`;
            app.log.info(msg);
            return msg;
          } catch (err2: any) {
            app.log.error(
              { err: errToJSON(err2), uuid },
              '❌ Failed to control lamp after retry'
            );
            return `Failed to control lamp ${uuid}: ${JSON.stringify(errToJSON(err2))}`;
          }
        }
        app.log.error(
          { err: errToJSON(err1), uuid },
          '❌ Failed to control lamp'
        );
        return `Failed to control lamp ${uuid}: ${JSON.stringify(errToJSON(err1))}`;
      }
    })
  );

  return results;
}

/** Загрузка конфига и миграция .env */
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
function migrateEnv() {
  const envPath = path.join(import.meta.dirname, '../.env');
  const configPath = path.join(import.meta.dirname, '../config.json');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
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
    loadConfig();
  }
}

loadConfig();
migrateEnv();

/** Старт сервера */
async function startServer() {
  await refreshToken(); // подтянет токен и поднимет WS
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

/** Маршруты */
app.get('/lightgroups', async (_req, reply): Promise<void> => {
  reply.send({
    message: '💡 Available light groups',
    lightGroups: config.lightGroups
  });
});

app.get('/switch/on', async (req, reply): Promise<void> => {
  const groupId = (req.query as any).switch as string;
  if (!groupId)
    return void reply.code(400).send({ error: 'Missing switch parameter' });
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

app.get('/switch/off', async (req, reply): Promise<void> => {
  const groupId = (req.query as any).switch as string;
  if (!groupId)
    return void reply.code(400).send({ error: 'Missing switch parameter' });
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

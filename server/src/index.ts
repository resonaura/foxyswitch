import express from 'express';
import axios from 'axios';
import cron from 'node-cron';
import * as dotenv from 'dotenv';
import fs from 'fs';

// Проверяем наличие файла .env
if (!fs.existsSync('.env')) {
  console.error('🔴 .env file is missing. Please create a .env file.');
  process.exit(1); // Прерываем выполнение, если .env не найден
}

// Загружаем переменные из .env
dotenv.config();

const app = express();
const port = process.env.PORT || 2322;

// Учетные данные и конфигурация Homebridge
const homebridgeUrl = process.env.HOMEBRIDGE_URL || 'http://localhost';
const username = process.env.HOMEBRIDGE_USERNAME || '';
const password = process.env.HOMEBRIDGE_PASSWORD || '';
const uuids = (process.env.HOMEBRIDGE_UUIDS || '').split(',');

let token = '';
let tokenExpiration = 0;

// Функция для обновления токена
async function refreshToken(): Promise<void> {
  try {
    const response = await axios.post(
      `${homebridgeUrl}/api/auth/login`,
      {
        username,
        password
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    token = response.data.access_token;
    tokenExpiration = Date.now() + (response.data.expires_in - 300) * 1000; // Обновляем токен за 5 минут до истечения

    console.log('🔐 Token refreshed successfully');
  } catch (error: any) {
    console.error('❌ Failed to refresh token', error.message);
  }
}

// Автоматическое обновление токена за 5 минут до истечения
cron.schedule('*/5 * * * *', () => {
  if (Date.now() >= tokenExpiration) {
    refreshToken();
  }
});

// Функция для управления лампочками
async function controlLamp(uuid: string, value: boolean): Promise<string> {
  try {
    await axios.put(
      `${homebridgeUrl}/api/accessories/${uuid}`,
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
    console.error(`❌ Failed to control lamp with UUID ${uuid}`, error.message);
    return `Failed to control lamp with UUID ${uuid}: ${error.message}`;
  }
}

// Включение всех ламп
app.get('/switch/on', async (req, res) => {
  const results = await Promise.all(
    uuids.map((uuid) => controlLamp(uuid, true))
  );
  res.json({
    message: '🟢 All lamps turned on',
    details: results
  });
});

// Выключение всех ламп
app.get('/switch/off', async (req, res) => {
  const results = await Promise.all(
    uuids.map((uuid) => controlLamp(uuid, false))
  );
  res.json({
    message: '🔴 All lamps turned off',
    details: results
  });
});

// Запуск сервера
app.listen(port, async () => {
  console.log(`🚀 Foxy Switch API listening at http://localhost:${port}`);
  await refreshToken(); // Обновляем токен при запуске
});

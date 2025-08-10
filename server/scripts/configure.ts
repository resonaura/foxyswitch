import fs from 'fs';
import path from 'path';
import {
  input,
  password,
  number,
  confirm} from '@inquirer/prompts';

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

async function configure() {
  console.log('🛠️  Welcome to the Foxy Switch API configuration wizard!');

  const configPath = path.join(import.meta.dirname, '../config.json');
  let config: Config = {
    homebridge: {
      url: 'http://localhost',
      username: 'admin',
      password: ''
    },
    port: 2322,
    lightGroups: {}
  };

  if (fs.existsSync(configPath)) {
    const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config = { ...config, ...existingConfig };
  }

  // Homebridge settings
  config.homebridge.url = await input({
    message: '🌐 Homebridge server URL:',
    default: config.homebridge.url
  });

  config.homebridge.username = await input({
    message: '👤 Homebridge username:',
    default: config.homebridge.username
  });

  config.homebridge.password = await password({
    message: '🔑 Homebridge password:',
    mask: '*'
    // default: config.homebridge.password, // Убираем default
  });

  // API port
  const portInput = await number({
    message: '🔌 Port for the API:',
    default: config.port
  });
  config.port = portInput ?? config.port;

  // Light groups configuration
  let addMoreGroups = true;
  config.lightGroups = {};

  while (addMoreGroups) {
    const groupId = await input({
      message: '💡 Enter a light group ID:'
    });

    const uuidsInput = await input({
      message: '💡 Enter UUIDs of the lamps (comma-separated):'
    });

    const uuids = uuidsInput.split(',').map((uuid) => uuid.trim());

    config.lightGroups[groupId] = uuids;

    addMoreGroups = await confirm({
      message: '➕ Do you want to add another light group?',
      default: false
    });
  }

  // Save configuration
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ Configuration saved successfully!');
}

configure();

import fs from 'fs';
import path from 'path';
import { input, password } from '@inquirer/prompts';

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

async function updateCredentials() {
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error(
      '🔴 Config file is missing. Please run the configuration script.'
    );
    process.exit(1);
  }
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  config.homebridge.username = await input({
    message: '👤 New Homebridge username:',
    default: config.homebridge.username
  });

  config.homebridge.password = await password({
    message: '🔑 New Homebridge password:',
    mask: '*'
  });

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ Homebridge credentials updated successfully!');
}

updateCredentials();

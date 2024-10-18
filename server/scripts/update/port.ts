import fs from 'fs';
import path from 'path';
import { number } from '@inquirer/prompts';

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

async function updatePort() {
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error(
      '🔴 Config file is missing. Please run the configuration script.'
    );
    process.exit(1);
  }
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  config.port =
    (await number({
      message: '🔌 New port for the API:',
      default: config.port
    })) ?? config.port;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ API port updated successfully!');
}

updatePort();

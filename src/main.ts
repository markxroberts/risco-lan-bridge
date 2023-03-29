#!/usr/bin/env node

import { PanelOptions, RiscoPanel } from './index';
import path from 'path';
import fs, { readFileSync } from 'fs';

function readConfig(): PanelOptions {
  const configPath = path.join(process.cwd(), 'config.json');
  console.log('Loading config from: ' + configPath);
  if (fs.existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } else {
    throw new Error('file config.json does not exist');
  }
}

const panel = new RiscoPanel(readConfig());
panel.on('SystemInitComplete', () => {
  // Listening to all events from all Partitions.
  // In this case, it is up to you to deal with the
  // type of events received and the action to be taken.
  console.log('System init => Done');

  panel.partitions.on('PStatusChanged', (Id, EventStr) => {
    console.log(`PStatusChanged: ${Id} ${EventStr}`);
  });

  panel.zones.on('ZStatusChanged', (Id, EventStr) => {
    console.log(`ZStatusChanged: ${Id} ${EventStr}`);
  
  panel.outputs.on('OStatusChanged', (Id, EventStr) => {
    console.log(`OStatusChanged: ${Id} ${EventStr}`);
  });
});


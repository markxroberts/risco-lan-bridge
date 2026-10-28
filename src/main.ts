#!/usr/bin/env node

import { PanelOptions, RiscoPanel } from './index';
import path from 'path';
import fs, { readFileSync } from 'fs';
import { load, CORE_SCHEMA, mergeTag } from 'js-yaml';

function readConfig(): PanelOptions {
  const configPathjson = path.join(process.cwd(), 'config.json');
  const configPathyaml = path.join(process.cwd(), 'config.yaml');
  if (fs.existsSync(configPathjson)) {
    console.log('[RLB] Loading config from: ' + configPathjson);
    return JSON.parse(readFileSync(configPathjson, 'utf-8'));
  }
  else if (fs.existsSync(configPathyaml)) {
    console.log('[RLB] Loading config from: ' + configPathyaml);
    return load(readFileSync(configPathyaml, 'utf-8'), { schema: CORE_SCHEMA.withTags(mergeTag) }) as PanelOptions;
  } else {
    throw new Error('[RLB] Config file does not exist.  Please ensure config.json or config.yaml present before restarting.');
  }
}

const panel = new RiscoPanel(readConfig());
panel.on('SystemInitComplete', () => {
  // Listening to all events from all Partitions.
  // In this case, it is up to you to deal with the
  // type of events received and the action to be taken.
  console.log('[RLB] System initialization complete');

  panel.partitions.on('PStatusChanged', (Id, EventStr) => {
    console.log(`PStatusChanged: ${Id} ${EventStr}`);
  });

  panel.zones.on('ZStatusChanged', (Id, EventStr) => {
    console.log(`ZStatusChanged: ${Id} ${EventStr}`);
  });

  panel.outputs.on('OStatusChanged', (Id, EventStr) => {
    console.log(`OStatusChanged: ${Id} ${EventStr}`);
  });

  panel.mbSystem.on('SStatusChanged', (Id, EventStr) => {
    console.log(`SStatusChanged: ${Id} ${EventStr}`);
  });
});


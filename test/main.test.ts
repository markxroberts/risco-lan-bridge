import { PanelOptions, RiscoPanel } from '../src'
import path from 'path'
import fs, { readFileSync } from 'fs'

function readConfig(): PanelOptions {
  const configPath = path.join(process.cwd(), 'config.json')
  console.log('Loading config from: ' + configPath)
  if (fs.existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } else {
    throw new Error('file config.json does not exist')
  }
}

describe('Panel test', () => {
  it('Test startup',async () => {
    return new Promise<boolean>((resolve, reject) => {
      try {
        const panel = new RiscoPanel(readConfig())
        panel.on('SystemInitComplete', () => {
          // Listening to all events from all Partitions.
          // In this case, it is up to you to deal with the
          // type of events received and the action to be taken.
          console.log('System init => Done')

          panel.disconnect().then(() => {
            resolve(true)
          })
        });
      } catch (e) {
        console.log('config.json parsing error', e)
        reject()
      }
    })
  }, 300000);

});

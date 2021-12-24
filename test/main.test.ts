import { RiscoPanel } from '../src'
import path from 'path'
import fs, { readFileSync } from 'fs'


describe('Panel test', () => {
  it('Test startup',async () => {
    return new Promise<boolean>((resolve, reject) => {
      try {
        const configPath = path.join(process.cwd(), 'config.json')
        console.log('Loading config from: ' + configPath)
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf-8'));
          const panel = new RiscoPanel(config)
          panel.on('SystemInitComplete', () => {
            // Listening to all events from all Partitions.
            // In this case, it is up to you to deal with the
            // type of events received and the action to be taken.
            console.log('System init => Done')

            panel.disconnect().then(() => {
              resolve(true)
            })
          });
        } else {
          console.log('file config.json does not exist')
          reject()
        }
      } catch (e) {
        console.log('config.json parsing error', e)
        reject()
      }
    })
  }, 300000);
});

[![license badge](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/markxroberts/risco-lan-bridge/blob/main/LICENSE)
[![Package Version](https://shields.io/npm/v/@markxroberts/risco-lan-bridge/latest)](https://www.npmjs.com/package/@markroberts/risco-lan-bridge)
[![Node Version](https://shields.io/node/v/@markxroberts/risco-lan-bridge)](https://www.npmjs.com/package/@markxroberts/risco-lan-bridge)
[![Maintenance badge](https://shields.io/badge/maintenance-yes-green.svg)](https://www.npmjs.com/package/@markxroberts/risco-lan-bridge)



# risco-lan-bridge
risco-lan-bridge is not intended to be used as is.
This program is intended to be used as a "bridge" between your application and a Risco alarm Panel (can also work with Electronic Line products but this has not been tested).

## Compatibility
risco-lan-bridge is compatible with these central units and these features:
||Agility|Wicomm|Wicomm Pro|LightSYS/Plus|ProSYSPlus/GTPlus|Other|
|--|:--:|:--:|:--:|:--:|:--:|:--:|
|Zones|Y*|Y*|Y*|Y|Y*|?|
|Partitions|Y*|Y*|Y*|Y|Y*|?|
|Outputs|Y*|Y*|Y*|Y|Y*|?|
|Groups|N**|N**|N**|N**|N**|?|
|Arming|Y*|Y*|Y*|Y|Y*|?|
|Stay Arming|Y*|Y*|Y*|Y|Y*|?|
|Temporised Arming|N**|N**|N**|N**|N**|?|
|Disarming|Y*|Y*|Y*|Y|Y*|?|
|Bypass/UnBypass Zones|Y*|Y*|Y*|Y|Y*|?|
|Command Outputs|Y*|Y*|Y*|Y|Y*|?|
|PirCam Support|N***|N***|N***|N|N***|?|

*=> Theoretical compatibility not tested.

**=> Not functional today. 

***=> Not functional today (planned for a future version).

***WARNING : For control panels equipped with a Mono-Socket type IP module (IPC / RW132IP), direct connection may not work if RiscoCloud is enabled in the configuration.
To use this module, you must therefore deactivate RiscoCloud and then restart your control panel (or the IP module by deactivating it and then reactivating it in the configuration from the keyboard).
This action will prevent the control panel from connecting to RiscoCloud and you will no longer be able to use it remotely from the iRisco application.***


## Configuration
First of all, you must define the options necessary to define the Risco Panel Object.
```
let  Options = {
// Define Panel IP Address (Optional)
panelIp:  '192.168.0.100',
// Define Panel TCP Port (Optional)
panelPort:  1000,
// Define Panel Access Code (Optional)
panelPassword:  5678,
// Define Panel ID (Optional)
panelId:  '0001',
// Activate autodiscover (Optional)
autoDiscover:  true,
// Defines the waiting time for a reconnection in ms (Optional)
ReconnectDelay:  10000,
// Defines automatic connection (Optional)
cloudConnectionDelay: 5000,
// Defines cloud reconnection delay
autoConnect:  true,
// Defines if the plugin should deactivate RiscoCloud on the control panel (Optional)
Disable_RiscoCloud:  true,
// Defines if the plugin should activate RiscoCloud on the control panel (Optional)
Enable_RiscoCloud:  true,
//Note :If the 'Disable_RiscoCloud' and 'Enable_RiscoCloud' options are both true, no changes will be made.
// Defines if the plugin should discover the access codes and the Id panel automatically (Optional)
DiscoverCode:  true,
// Defines the operating mode of the TCP Socket ('direct' or 'proxy') (Optional)
// see wiki for more information
SocketMode: 'direct',
// In Proxy Mode, define the listening TCP port for the Panel to connect (Optional)
ListeningPort: 33000,
// In Proxy Mode, define the TCP port to connect to RiscoCloud (Optional)
CloudPort: 33000,
// In Proxy Mode, define the URL to connect to RiscoCloud (Optional)
CloudUrl: 'www.riscocloud.com',
// Defines an overload function for logging (Optional)
logger:  logger_function,
// Defines a specific channel for logs (Optional - default channel is 'console')
log:  log_channel
};
````
All these options are not mandatory, the only really essential option is the 'panelIp' option (unless the TCP Port, Panel Id and remote password are not the default ones, in which case they must also be specified).

For Socket mode, see the [wiki](https://github.com/TJForc/risco-lan-bridge/wiki/Socket-Mode) for more information

You can then create your RiscoPanel Object:
```
// Create Agility Object
let  RPanel = new  RiscoTCPPanel.Agility(Options);
// Or create WiComm Object
let  RPanel = new  RiscoTCPPanel.WiComm(Options);
// Or create WiCommPro Object
let  RPanel = new  RiscoTCPPanel.WiCommPro(Options);
// Or create LightSys Object
let  RPanel = new  RiscoTCPPanel.LightSys(Options);
// Or create LightSysPlus object
let  RPanel = new  RiscoTCPPanel.LightSysPlus(Options);
// Or create ProsysPlus Object
let  RPanel = new  RiscoTCPPanel.ProsysPlus(Options);
// Or create GTPlus Object
let  RPanel = new  RiscoTCPPanel.GTPlus(Options);
```
With the default options, the connection will be automatically made and you will obtain an object representing your control panel and permanently reflecting the real state of the equipment.

For more information regarding operation or interactions with the hardware, please refer to the wiki.

### License
risco-lan-bridge is licensed under the MIT license, so you can dispose of it as you see fit under the terms of that license.


## Development and publishing

Use Node.js 22.14 or newer. Run `npm ci`, `npm run lint`, `npm run build`, `npm run typecheck:test`, and `npm test`. The default test command runs unit tests without a panel. `npm run test:integration` requires a real panel and local `config.json`; it is intentionally excluded from CI. `npm start` starts the example program and accepts JSON or YAML configuration.

The supported Node versions are checked on GitHub Actions (22, 24, and 26). npm and GitHub Actions dependencies are checked weekly by Dependabot. `package-lock.json` is the lockfile used by CI and local installs; the former Yarn lockfile and unused TSDX/watch dependencies were removed.

TypeScript stays on the 6.0 minor line: the current TypeScript ESLint parser supports TypeScript below 6.1 and ts-jest supports versions below 7. Node typings match the minimum supported Node 22 runtime. Update these together when the tools support a newer compiler. ESLint uses the current flat configuration format.

The production dependency audit is clear. The full development audit currently reports a low-severity [unpatched deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) through Jest's configuration dependencies (six package entries for the same advisory). The affected dependency is not shipped as a production dependency. Avoid automatic major downgrades suggested by `npm audit fix --force`; update Jest/deepmerge when a compatible fix becomes available.

To release a new version:

1. Choose a new package version, update `package.json` and `package-lock.json` together (for example with `npm version <new-version> --no-git-tag-version`), update this changelog, and commit the changes.
2. Ensure **this bridge repository** has an Actions secret named `NPM_TOKEN` with npm publishing access to `@markxroberts/risco-lan-bridge`. Repository secrets are not shared automatically with risco-mqtt-local.
3. Publish a GitHub release from that commit, with the tag exactly matching the package version and no `v` prefix. A mismatch produces a named error annotation and a job summary. Publishing only runs after the Node matrix passes. Prereleases publish under npm's `next` tag; other releases use `latest`.

The workflow no longer forces version `0.16.22`. Choose an unpublished version; npm versions cannot be overwritten. Pull requests only run checks, and this PR does not publish anything. After releasing the bridge, update the bridge dependency and lockfile in risco-mqtt-local, test against the real panel, and release the add-on to make these changes available to users.

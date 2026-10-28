import { RiscoProxyTCPSocket } from '../src/RiscoProxySocket'
import { SocketOptions } from '../src/RiscoBaseSocket'
import { logger } from '../src/Logger'

jest.mock('net', () => {
  const { EventEmitter } = require('events')
  class FakeSocket extends EventEmitter {
    destroyed = false
    setTimeout = jest.fn(() => this)
    pause = jest.fn(() => this)
    resume = jest.fn(() => this)
    connect = jest.fn(() => this)
    write = jest.fn(() => true)
    destroy = jest.fn(() => {
      if (!this.destroyed) { this.destroyed = true; this.emit('close') }
      return this
    })
  }
  class FakeServer extends EventEmitter {
    listening = false
    listen = jest.fn(() => { this.listening = true; return this })
    close = jest.fn(() => { this.listening = false; return this })
    address = jest.fn(() => ({ address: '::', port: 33000 }))
  }
  return { Socket: jest.fn(() => new FakeSocket()), Server: jest.fn(() => new FakeServer()) }
})
const net = jest.requireMock('net')
const options: SocketOptions = {
  listeningPort: 33000, panelIp: 'localhost', panelPort: 1000,
  panelId: 1, guessPasswordAndPanelId: false, panelPassword: '1234',
  encoding: 'utf8', cloudUrl: 'cloud.test', cloudPort: 33000,
  panelConnectionDelay: 30000, cloudConnectionDelay: 10000,
  socketMode: 'proxy', badCRCLimit: 10,
}
function latestCloud() { return net.Socket.mock.results.slice(-1)[0].value }
async function fixture() {
  const proxy = new RiscoProxyTCPSocket(options, undefined)
  const disconnect = jest.fn()
  proxy.on('Disconnected', disconnect)
  const send = jest.spyOn(proxy, 'sendCommand').mockResolvedValue('ACK')
  const login = jest.spyOn(proxy as unknown as { panelConnect: () => Promise<boolean> }, 'panelConnect').mockResolvedValue(true)
  await proxy.connect()
  const server = net.Server.mock.results.slice(-1)[0].value
  const panel = new net.Socket()
  server.emit('connection', panel)
  return { proxy, panel, server, disconnect, send, login }
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); jest.spyOn(logger, 'log').mockImplementation(() => {}) })
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks() })

test('repeated initial cloud failures preserve the panel and recover without panel reconnection', async () => {
  const f = await fixture()
  expect(f.panel.pause).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 5; i++) {
    const failed = latestCloud()
    failed.emit('error', new Error('ECONNREFUSED'))
    failed.emit('close') // Duplicate close must not queue a second attempt.
    const count = net.Socket.mock.calls.length
    jest.advanceTimersByTime(10000)
    expect(net.Socket.mock.calls.length).toBe(count + 1)
    expect(f.panel.destroyed).toBe(false)
    expect(f.disconnect).not.toHaveBeenCalled()
  }
  const cloud = latestCloud()
  cloud.emit('ready')
  expect(f.panel.resume).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(30000)
  expect(f.login).toHaveBeenCalledTimes(1)
  expect(f.send).not.toHaveBeenCalled()
})

test('panel close during a failed cloud connect cancels retries and notifies once', async () => {
  const f = await fixture()
  latestCloud().emit('error', new Error('ECONNREFUSED'))
  f.panel.emit('close')
  const count = net.Socket.mock.calls.length
  jest.advanceTimersByTime(180000)
  expect(net.Socket.mock.calls.length).toBe(count)
  expect(f.disconnect).toHaveBeenCalledTimes(1)
  expect(f.send).not.toHaveBeenCalled()
})

test('cloud loss after a ready session still resets both sides and leaves no orphan retry', async () => {
  const f = await fixture()
  const cloud = latestCloud()
  cloud.emit('ready')
  cloud.destroy()
  expect(f.disconnect).toHaveBeenCalledTimes(1)
  expect(f.panel.destroyed).toBe(true)
  const count = net.Socket.mock.calls.length
  jest.advanceTimersByTime(180000)
  expect(f.login).not.toHaveBeenCalled()
  expect(net.Socket.mock.calls.length).toBe(count)
})

test('a cloud TCP connect timeout closes the socket and queues one bounded retry', async () => {
  const f = await fixture()
  const cloud = latestCloud()
  expect(cloud.setTimeout).toHaveBeenCalledWith(30000)
  cloud.emit('timeout')
  expect(cloud.destroyed).toBe(true)
  jest.advanceTimersByTime(10000)
  expect(latestCloud()).not.toBe(cloud)
  expect(f.panel.destroyed).toBe(false)
})

test('manual disconnect cancels an initial cloud retry and is idempotent', async () => {
  const f = await fixture()
  latestCloud().emit('error', new Error('ECONNREFUSED'))
  await f.proxy.disconnect(false)
  await f.proxy.disconnect(false)
  const count = net.Socket.mock.calls.length
  jest.advanceTimersByTime(180000)
  expect(net.Socket.mock.calls.length).toBe(count)
  expect(f.disconnect).toHaveBeenCalledTimes(1)
  expect(f.disconnect).toHaveBeenCalledWith(false)
})

test('authenticated disconnect still sends DCN but destroys captured sockets only once', async () => {
  const f = await fixture()
  f.proxy.isPanelConnected = true
  await Promise.all([f.proxy.disconnect(true), f.proxy.disconnect(true)])
  expect(f.send).toHaveBeenCalledWith('DCN')
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.panel.destroyed).toBe(true)
  expect(f.disconnect).toHaveBeenCalledTimes(1)
})

test('panel errors are handled even before the first cloud ready event', async () => {
  const f = await fixture()
  expect(() => f.panel.emit('error', new Error('ECONNRESET'))).not.toThrow()
  expect(f.disconnect).toHaveBeenCalledTimes(1)
  expect(f.panel.destroyed).toBe(true)
})

test('late ready and timer callbacks cannot initialize a disconnected proxy', async () => {
  const f = await fixture()
  const cloud = latestCloud()
  cloud.emit('ready')
  const lateReady = cloud.listeners('ready')[0]
  await f.proxy.disconnect(false)
  lateReady()
  jest.advanceTimersByTime(180000)
  expect(f.login).not.toHaveBeenCalled()
  expect(f.disconnect).toHaveBeenCalledTimes(1)
})

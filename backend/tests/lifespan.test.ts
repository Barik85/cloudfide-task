import { afterEach, beforeEach, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  initialize: vi.fn(),
  resolveDatabaseUrl: vi.fn(),
  createApp: vi.fn(),
}));
vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: mocks.resolveDatabaseUrl }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

import { start } from '../src/core/lifespan.ts';

function setup() {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = { address: () => ({ port: 1234 }), close: vi.fn((cb: () => void) => cb()) };
  const listener = { once: vi.fn() };
  const app = { listen: vi.fn((port: number, host: string, cb: () => void) => { queueMicrotask(cb); return Object.assign(listener, server); }) };
  mocks.createDatabase.mockReturnValue(database);
  mocks.createApp.mockReturnValue(app);
  return { database, server, listener, app };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.resolveDatabaseUrl.mockReturnValue('postgresql://test');
  vi.stubEnv('API_PORT', '4321');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.exitCode = undefined;
});

it('connects, initializes and listens on API_PORT', async () => {
  const { database, app } = setup();
  const once = vi.spyOn(process, 'once').mockImplementation(() => process);
  const result = await start();
  expect(mocks.createDatabase).toHaveBeenCalledWith('postgresql://test');
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(mocks.initialize).toHaveBeenCalledWith(database);
  expect(app.listen).toHaveBeenCalledWith(4321, '0.0.0.0', expect.any(Function));
  expect(result.database).toBe(database);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1234'));
  expect(once.mock.calls.map(([name]) => name)).toEqual(['SIGTERM', 'SIGINT']);
});

it('defaults to port 8000 when API_PORT is unset', async () => {
  const { app } = setup();
  vi.stubEnv('API_PORT', '');
  vi.spyOn(process, 'once').mockImplementation(() => process);
  await start();
  expect(app.listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});

it('closes the server and disconnects the database on shutdown', async () => {
  const { database, server } = setup();
  const once = vi.spyOn(process, 'once').mockImplementation(() => process);
  await start();
  const shutdown = once.mock.calls[0][1] as () => void;
  shutdown();
  await vi.advanceTimersByTimeAsync(0);
  expect(server.close).toHaveBeenCalledOnce();
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(process.exitCode).toBeUndefined();
});

it('sets a failing exit code when disconnecting during shutdown fails', async () => {
  const { database } = setup();
  const once = vi.spyOn(process, 'once').mockImplementation(() => process);
  await start();
  database.$disconnect.mockRejectedValue(new Error('disconnect failed'));
  (once.mock.calls[0][1] as () => void)();
  await vi.advanceTimersByTimeAsync(0);
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalled();
});

it('disconnects and rethrows when startup fails', async () => {
  const { database } = setup();
  database.$connect.mockRejectedValue(new Error('no database'));
  await expect(start()).rejects.toThrow('no database');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(mocks.createApp).not.toHaveBeenCalled();
});

it('disconnects and rethrows when listening fails', async () => {
  const { database, app } = setup();
  app.listen.mockImplementation(() => ({
    once: (event: string, handler: (error: Error) => void) => { if (event === 'error') handler(new Error('EADDRINUSE')); },
  }) as never);
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
});

import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = { todo: { findMany: vi.fn().mockResolvedValue([record]), findFirst: vi.fn().mockResolvedValue(null) } };
  return { app: createApp(database as unknown as Database), database };
}

it('serves the todos router backed by the repository', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
});
it('serves the health endpoint', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/health');
  expect(response.body).toEqual({ status: 'ok' });
});
it('does not expose x-powered-by', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/health')).headers['x-powered-by']).toBeUndefined();
});
it('serves the OpenAPI specification', async () => {
  const { app } = setup();
  const response = await request(app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
});
it('returns a JSON 404 for unknown routes', async () => {
  const { app } = setup();
  const response = await request(app).get('/nope');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('returns 422 for malformed JSON bodies', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});
it('returns 413 for oversized bodies', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('returns 500 and logs unexpected errors', async () => {
  const { app, database } = setup();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  database.todo.findMany.mockRejectedValue(new Error('boom'));
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(logged).toHaveBeenCalled();
});

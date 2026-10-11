import { afterEach, describe, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const names = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];

function stub(values: Record<string, string> = {}) {
  for (const name of names) vi.stubEnv(name, values[name] ?? '');
}

afterEach(() => vi.unstubAllEnvs());

describe('resolveDatabaseUrl', () => {
  it('prefers the override and normalises the SQLAlchemy driver prefix', () => {
    stub({ DATABASE_URL: 'postgresql://env/db' });
    expect(resolveDatabaseUrl('postgresql+psycopg://u:p@host:5432/db')).toBe('postgresql://u:p@host:5432/db');
  });
  it('uses DATABASE_URL when no override is given', () => {
    stub({ DATABASE_URL: 'postgresql://env:pw@h:1/db' });
    expect(resolveDatabaseUrl()).toBe('postgresql://env:pw@h:1/db');
  });
  it('builds the URL from individual variables and encodes the database name', () => {
    stub({ POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'pw', POSTGRES_HOST: 'db.local', DB_PORT: '5433', POSTGRES_DB: 'my db' });
    expect(resolveDatabaseUrl()).toBe('postgresql://user:pw@db.local:5433/my%20db');
  });
  it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'])('throws when %s is missing', (name) => {
    const all = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'pw', POSTGRES_HOST: 'h', DB_PORT: '5432', POSTGRES_DB: 'db' };
    stub({ ...all, [name]: '' });
    expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
  });
});

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env';
import * as schema from '../db/schema';

const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export async function checkDbConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export { queryClient };

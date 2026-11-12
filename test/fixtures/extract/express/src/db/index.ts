import { Pool } from 'pg';
import { log } from '../log';
export const db = { users: async () => [], user: async (_: string) => null, addUser: async (_: unknown) => null, pool: new Pool() };
log('db');

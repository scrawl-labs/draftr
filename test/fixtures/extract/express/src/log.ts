import { db } from './db';
export const log = (m: string) => { if (db) console.log(m); };

import express from 'express';
import users from './routes/users';
import orders from './routes/orders.js';
import { log } from '@/log';
const app = express();
app.use('/api/users', users);
app.use('/api/orders', orders);
app.get('/health', (_req, res) => res.send('ok'));
// app.get('/commented-out', ...)
log('up');

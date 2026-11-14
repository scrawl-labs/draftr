import { Router } from 'express';
import { db } from '../db';
import type { User } from '../types';
const router = Router();
router.get('/', async (_req, res) => res.json(await db.users()));
router.get('/:id', async (req, res) => res.json(await db.user(req.params.id)));
router.post('/', async (req, res) => res.json(await db.addUser(req.body)));
export default router;

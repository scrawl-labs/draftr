import { Router } from 'express';
import { db } from '../db/index.js';
const router = Router();
router.route('/:id').get(() => {}).delete(() => {});
router.post('/', () => {});
export default router;

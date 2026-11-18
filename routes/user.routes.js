import { Router } from 'express';
import { createUserController } from '../controller/user.controller.js';

// Mounted at /api/users
export function createUserRouter(userService) {
  const router = Router();
  const controller = createUserController(userService);
  router.post('/', controller.addUser);
  router.get('/', controller.listUsers);
  router.get('/email/:email', controller.getUserByEmail);
  router.put('/:id', controller.updateUser);
  return router;
}

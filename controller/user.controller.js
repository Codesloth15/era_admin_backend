// The user API answers its own errors, with the same messages it has always returned.
export function createUserController(userService) {
  return {
    async addUser(req, res) {
      try {
        const userData = req.body;
        if (!userData.email) return res.status(400).json({ error: 'Email is required' });
        const id = await userService.addUser(userData);
        res.json({ message: 'User added successfully', id });
      } catch (err) {
        console.error('Error adding user:', err);
        res.status(500).json({ error: 'Failed to add user' });
      }
    },
    async listUsers(req, res) {
      try {
        res.json({ users: await userService.listUsers() });
      } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
      }
    },
    async getUserByEmail(req, res) {
      try {
        const user = await userService.findUserByEmail(req.params.email);
        if (user === null) return res.status(404).json({ error: 'No users found' });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
      } catch (err) {
        console.error('Error fetching user by email:', err);
        res.status(500).json({ error: 'Failed to fetch user' });
      }
    },
    async updateUser(req, res) {
      try {
        await userService.updateUser(req.params.id, req.body);
        res.json({ message: 'User updated successfully' });
      } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Failed to update user' });
      }
    },
  };
}

// Active responder records used by the older user management screens.
const USERS_PATH = 'cdrrmc/activeresponders';

export function createUserService(db) {
  const usersRef = db.ref(USERS_PATH);
  return {
    async addUser(userData) {
      const newUserRef = usersRef.push();
      await newUserRef.set(userData);
      return newUserRef.key;
    },
    async listUsers() {
      const snapshot = await usersRef.once('value');
      return snapshot.exists() ? snapshot.val() : [];
    },
    // Returns null when there are no users at all, undefined when none has this email.
    async findUserByEmail(email) {
      const snapshot = await usersRef.once('value');
      if (!snapshot.exists()) return null;
      const users = snapshot.val();
      const userKey = Object.keys(users).find(key => users[key].email === email);
      return userKey ? { id: userKey, ...users[userKey] } : undefined;
    },
    async updateUser(id, updates) {
      await usersRef.child(id).update(updates);
    },
  };
}

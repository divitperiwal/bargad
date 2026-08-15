import { users } from '#database/schema';

export const publicUser = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
};

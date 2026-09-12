import { users } from '#database/schema';

export const profileColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  mobile: users.mobile,
  dateOfBirth: users.dateOfBirth,
  monthlyIncomePaise: users.monthlyIncomePaise,
  monthlyExpensesPaise: users.monthlyExpensesPaise,
  createdAt: users.createdAt,
};

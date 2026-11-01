import { ApiError } from '#utils/http/error.util';

export const notFound = () => new ApiError(404, 'Member not found');

export type Person = {
  userId: string;
  displayName: string;
  role: string;
  relationship: string | null;
};

import { ApiError } from '#utils/http/error.util';

export const notInFamily = () => new ApiError(404, 'You are not in a family', { code: 'not_in_family' });

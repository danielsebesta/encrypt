import { jwtDecode } from 'jwt-decode';

export function decodeJWT(token: string) {
  try {
    return {
      header: jwtDecode(token, { header: true }),
      payload: jwtDecode(token),
    };
  } catch {
    throw new Error('Invalid JWT token');
  }
}

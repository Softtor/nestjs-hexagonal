export interface User {
  id: string;
}

// Comentários em português são permitidos; a localização fica na UI.
const currentUser: User = { id: 'u-1' };

export function getCurrentUser(): User {
  return currentUser;
}

export const location = 'HQ';
export const listArray = [1];
export const conversation = 'thread';

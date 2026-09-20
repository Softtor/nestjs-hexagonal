export interface Usuario {
  id: string;
}

const usuarioAtual: Usuario = { id: 'u-1' };

export function getCurrentUser(): Usuario {
  return usuarioAtual;
}

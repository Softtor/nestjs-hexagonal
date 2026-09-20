export interface IdGeneratorPort {
  generate(): string;
  generateBatch(count: number): string[];
}

export const ID_GENERATOR_PORT = Symbol('IdGeneratorPort');

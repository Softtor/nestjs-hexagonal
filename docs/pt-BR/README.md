# NestJS Arquitetura Hexagonal

Este repositório demonstra a implementação de uma arquitetura hexagonal (Portas e Adaptadores) com NestJS.

## Estrutura do Projeto
- **Domain:** Entidades de domínio e regras de negócio puras.
- **Application:** Casos de uso e portas de entrada/saída.
- **Infrastructure:** Adaptadores de banco de dados, controladores HTTP e serviços externos.

## Execução
```bash
npm install
npm run start:dev
```

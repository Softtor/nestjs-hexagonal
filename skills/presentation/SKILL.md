---
name: presentation
description: Use when creating presentation layer artifacts for a NestJS bounded context — REST controllers, request DTOs with class-validator, Swagger decorators, custom validators, error filters, or API documentation. Covers the HTTP boundary with proper validation and error mapping.
argument-hint: Entity or artifact (e.g., "controller Orders", "dto CreateOrder", "error-filter")
---

# Presentation Layer

The presentation layer is the HTTP boundary. It owns input validation, Swagger docs, and error mapping. It must not contain business logic.

## Directory Structure

```
infrastructure/
└── controllers/
    ├── <context>.controller.ts
    ├── __tests__/
    │   └── <context>.controller.spec.ts
    └── dtos/
        ├── create-<context>.request.dto.ts
        ├── update-<context>.request.dto.ts
        ├── list-<context>.request.dto.ts
        └── __tests__/
            └── create-<context>.request.dto.spec.ts
```

Or as a top-level `presentation/` folder when separated from `infrastructure/`:

```
presentation/
├── controllers/
│   └── <context>.controller.ts
├── dtos/
│   └── create-<context>.http-dto.ts
├── presenters/
│   └── create-<context>.presenter.ts     # maps use case output to HTTP response
└── validators/
    └── <field>.validator.ts              # @ValidatorConstraint classes
```

## 1. Controller Pattern

Use `CommandBus` / `QueryBus` for CQRS contexts. Use `@Inject(TOKEN)` for plain use case contexts.

```typescript
// controllers/<context>.controller.ts
import {
  Controller, Post, Get, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '@/auth/guards/auth.guard';
import { CurrentUser, User } from '@/auth/decorators/current-user.decorator';
import { CurrentOrganization, OrgContext } from '@/auth/decorators/current-organization.decorator';
import { Create<Context>RequestDto } from './dtos/create-<context>.request.dto';
import { Create<Context>Command } from '../../application/commands/create-<context>.command';
import { Get<Context>Query } from '../../application/queries/get-<context>.query';
import { List<Context>Query } from '../../application/queries/list-<context>.query';

@ApiTags('<Contexts>')
@Controller('<contexts>')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class <Context>Controller {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new <context>' })
  @ApiResponse({ status: 201, description: '<Context> created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Body() dto: Create<Context>RequestDto,
    @CurrentOrganization() org: OrgContext,
  ): Promise<{ id: string }> {
    return this.commandBus.execute(
      new Create<Context>Command(org.id, dto.name),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get <context> by id' })
  @ApiResponse({ status: 200, description: '<Context> found' })
  @ApiResponse({ status: 404, description: '<Context> not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentOrganization() org: OrgContext,
  ) {
    return this.queryBus.execute(new Get<Context>Query(id, org.id));
  }

  @Get()
  @ApiOperation({ summary: 'List <contexts> with pagination' })
  async findAll(
    @Query() query: List<Context>RequestDto,
    @CurrentOrganization() org: OrgContext,
  ) {
    return this.queryBus.execute(
      new List<Context>Query({ organizationId: org.id, ...query }),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a <context>' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(
    @Param('id') id: string,
    @CurrentOrganization() org: OrgContext,
  ): Promise<void> {
    await this.commandBus.execute(new Delete<Context>Command(id, org.id));
  }
}
```

See full template: `references/controller-patterns.md`

## 2. Request DTOs

`class-validator` and `class-transformer` live ONLY in request DTOs. Never in domain VOs or application services.

```typescript
// controllers/dtos/create-<context>.request.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Create<Context>RequestDto {
  @ApiProperty({ description: 'Name', example: 'My <Context>' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Description', example: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string;
}
```

Global `ValidationPipe` config (in `main.ts`):

```typescript
app.useGlobalPipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
);
```

See full template: `references/request-dto-patterns.md`

## 3. Custom Validators

For cross-field or complex format rules that `class-validator` built-ins cannot express.

```typescript
// validators/<field>.validator.ts
import {
  ValidatorConstraint, ValidatorConstraintInterface,
  ValidationArguments, ValidationOptions, registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: '<validatorName>', async: false })
export class <Field>Validator implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    // Return true = valid, false = invalid
    return typeof value === 'string' && value.length > 0;
  }

  defaultMessage(): string {
    return '<Field> is invalid';
  }
}

export function Is<Field>(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: <Field>Validator,
    });
  };
}
```

See full template: `references/request-dto-patterns.md` (custom validator section)

## 4. Validation Layers

Each layer has a single validation responsibility. Do not duplicate across layers.

```
Request DTO (presentation)     — format, presence, types (class-validator)
     ↓
Application DTO (application)  — contract between layers (TypeScript interfaces)
     ↓
Domain VO (domain)             — business invariants (manual validate())
     ↓
Queue Schema (integration)     — inter-service contracts (Zod)
```

See full diagram: `references/validation-layers.md`

## 5. Error Filter

Maps domain errors to HTTP status codes. Registered globally.

```typescript
// infrastructure/filters/http-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError } from '@/shared/domain/errors/not-found-error';
import { BusinessRuleViolationError } from '@/shared/domain/errors/business-rule-violation.error';
import { ConflictError } from '@/shared/domain/errors/conflict.error';

const ERROR_STATUS_MAP: Array<[new (...args: never[]) => Error, HttpStatus]> = [
  [NotFoundError, HttpStatus.NOT_FOUND],
  [BusinessRuleViolationError, HttpStatus.UNPROCESSABLE_ENTITY],
  [ConflictError, HttpStatus.CONFLICT],
];

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    for (const [ErrorClass, httpStatus] of ERROR_STATUS_MAP) {
      if (exception instanceof ErrorClass) {
        status = httpStatus;
        break;
      }
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception);
    }

    void reply.status(status).send({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

See full template: `references/error-filter-patterns.md`

## 6. Swagger Documentation

Always add `@ApiOperation`, `@ApiResponse`, and `@ApiProperty`. Include request body examples for complex DTOs.

```typescript
@ApiBody({
  type: Create<Context>RequestDto,
  examples: {
    basic: {
      summary: 'Basic example',
      value: { name: 'My <Context>' },
    },
  },
})
```

## Rules

- `class-validator` decorators ONLY in request DTOs — never in domain VOs or application services.
- Global `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`.
- Controller methods contain no business logic — delegate immediately to `CommandBus`/`QueryBus` or use case.
- Always include `organizationId` from the current auth context — never trust it from the request body.
- `HttpExceptionFilter` maps domain errors to status codes — domain layer never imports NestJS.
- All endpoints documented with `@ApiOperation` and `@ApiResponse`.

## Checklist

- [ ] Controller: `@ApiTags`, `@UseGuards`, `@ApiBearerAuth`
- [ ] Controller: organization context from `@CurrentOrganization()`, not from body/params
- [ ] Request DTOs: `class-validator` decorators + `@ApiProperty`
- [ ] Request DTOs: `@IsOptional()` before other decorators for optional fields
- [ ] Nested DTOs: `@ValidateNested()` + `@Type(() => NestedDto)`
- [ ] Array DTOs: `@IsArray()` + `@ValidateNested({ each: true })` + `@Type(() => ItemDto)`
- [ ] Custom validators: `@ValidatorConstraint` + `registerDecorator` factory
- [ ] Error filter registered globally or at module level
- [ ] Swagger: `@ApiOperation`, `@ApiResponse` for all endpoints
- [ ] Controller tests: mock `CommandBus`/`QueryBus`, test routing and DTO mapping
- [ ] DTO tests: use `class-validator` `validate()` to test valid/invalid inputs
- [ ] Run `pnpm lint && pnpm check-types` before committing

// Nest.js adapter — `@simpleq/sdk/nest`. Requires the optional `@nestjs/common` peer and an
// app created with `NestFactory.create(App, { rawBody: true })` so `request.rawBody` is set.
import 'reflect-metadata';
import {
  Catch,
  Inject,
  Injectable,
  Module,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type {
  ArgumentsHost,
  CanActivate,
  DynamicModule,
  ExceptionFilter,
  ExecutionContext,
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Provider,
} from '@nestjs/common';
import { verifyWebhook, SIGNATURE_HEADER } from './webhooks.js';
import { SimpleQBackpressure } from './errors.js';
import type { WebhookPayload } from './types.js';

/** Injection token holding the resolved `SimpleQModule` options. */
export const SIMPLEQ_WEBHOOK_OPTIONS = 'SIMPLEQ_WEBHOOK_OPTIONS';

export interface SimpleQNestOptions {
  signingSecret: string;
}

export interface SimpleQNestAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => SimpleQNestOptions | Promise<SimpleQNestOptions>;
}

interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

interface RequestWithJob extends RawRequest {
  simpleqJob?: WebhookPayload;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Guard that verifies the `x-simpleq-signature` header against `request.rawBody`. On success it
 * stashes the parsed job for `@SimpleQJob()`; on failure it throws `UnauthorizedException` (401).
 */
@Injectable()
export class SimpleQSignatureGuard implements CanActivate {
  constructor(@Inject(SIMPLEQ_WEBHOOK_OPTIONS) private readonly options: SimpleQNestOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithJob>();
    if (!req.rawBody) {
      throw new Error(
        'SimpleQ: request.rawBody is undefined — create the app with NestFactory.create(App, { rawBody: true }).',
      );
    }
    try {
      req.simpleqJob = verifyWebhook(
        req.rawBody,
        firstHeader(req.headers[SIGNATURE_HEADER]),
        this.options.signingSecret,
      );
    } catch {
      throw new UnauthorizedException('Invalid SimpleQ webhook signature');
    }
    return true;
  }
}

/** Parameter decorator that injects the verified, typed webhook payload into a route handler. */
export const SimpleQJob = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WebhookPayload => {
    const req = context.switchToHttp().getRequest<RequestWithJob>();
    if (!req.simpleqJob) {
      throw new Error('SimpleQ: @SimpleQJob() requires SimpleQSignatureGuard — apply @UseGuards(SimpleQSignatureGuard).');
    }
    return req.simpleqJob;
  },
);

interface BackpressureResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { end(): unknown };
}

/** Exception filter mapping a thrown `SimpleQBackpressure` to its status + `Retry-After` header. */
@Catch(SimpleQBackpressure)
export class SimpleQBackpressureFilter implements ExceptionFilter {
  catch(exception: SimpleQBackpressure, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<BackpressureResponse>();
    if (exception.retryAfter != null) res.setHeader('Retry-After', String(exception.retryAfter));
    res.status(exception.status).end();
  }
}

const PROVIDERS: Provider[] = [SimpleQSignatureGuard, SimpleQBackpressureFilter];
const EXPORTS = [SIMPLEQ_WEBHOOK_OPTIONS, SimpleQSignatureGuard, SimpleQBackpressureFilter];

/** Provides the signing secret plus the guard and backpressure filter to your Nest app. */
@Module({})
export class SimpleQModule {
  static forRoot(options: SimpleQNestOptions): DynamicModule {
    return {
      module: SimpleQModule,
      providers: [{ provide: SIMPLEQ_WEBHOOK_OPTIONS, useValue: options }, ...PROVIDERS],
      exports: EXPORTS,
    };
  }

  static forRootAsync(options: SimpleQNestAsyncOptions): DynamicModule {
    return {
      module: SimpleQModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: SIMPLEQ_WEBHOOK_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ...PROVIDERS,
      ],
      exports: EXPORTS,
    };
  }
}

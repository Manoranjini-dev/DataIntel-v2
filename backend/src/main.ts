// ──────────────────────────────────────────────
// Main Bootstrap — Application Entry Point
// ──────────────────────────────────────────────

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { StrictValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const isDev = process.env.NODE_ENV !== 'production';

  const app = await NestFactory.create(AppModule, {
    logger: isDev
      ? ['error', 'warn', 'log', 'debug', 'verbose']
      : ['error', 'warn', 'log'],
  });

  // Security headers
  app.use(helmet());

  // Cookie parser for session management
  app.use(cookieParser());

  // CORS — allow frontend origin with credentials
  app.enableCors({
    origin: [
      'http://localhost:3000',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
    credentials: true,
  });

  // Global pipes
  app.useGlobalPipes(StrictValidationPipe);

  // Global filters
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // API prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`══════════════════════════════════════════════`);
  logger.log(`  DataIntel v2 — Multi-Org Intelligence Platform`);
  logger.log(`  Running on: http://localhost:${port}`);
  logger.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`  Database: Neon Postgres (connected)`);
  logger.log(`══════════════════════════════════════════════`);
}

bootstrap();

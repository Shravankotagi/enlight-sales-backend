import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { swaggerConfig } from './config/swagger.config';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { CustomLoggerService } from './common/services/logger.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const logger = app.get(CustomLoggerService);

  // Enable CORS for all browsers and environments
  app.enableCors({
    origin: true,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // Apply global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(logger),
    new TransformInterceptor(),
  );

  // Enable validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Setup Swagger safely
  try {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  } catch (err: any) {
    console.warn('Swagger init notice:', err?.message || err);
  }

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`[Express Server] Running on port ${port}`);
}
bootstrap();

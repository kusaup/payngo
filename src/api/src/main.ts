import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  if (process.env.SERVE_CLIENT === 'true') {
    const distPath = process.env.CLIENT_DIST_PATH || '../client/dist/client';
    app.useStaticAssets(join(__dirname, distPath));
  }

  await app.listen(process.env.PORT || 3000);
}

bootstrap();

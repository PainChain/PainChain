import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // Enable CORS
  app.enableCors();

  const port = process.env.PORT || 8000;
  await app.listen(port);

  console.log(`🚀 PainChain backend running on http://localhost:${port}`);
  console.log(`📡 API available at http://localhost:${port}/api`);
}

bootstrap();

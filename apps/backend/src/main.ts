import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true, // Enable CORS for frontend
  })

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('PainChain API')
    .setDescription('Unified Change Management & Incident Investigation API')
    .setVersion('2.0')
    .addTag('changes', 'Change events timeline')
    .addTag('connections', 'Connector connections management')
    .addTag('connectors', 'Connector metadata and types')
    .addTag('teams', 'Team management')
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document)

  const port = process.env.PORT || 8000
  await app.listen(port)

  console.log('🚀 PainChain API running')
  console.log(`   ├─ API: http://localhost:${port}`)
  console.log(`   └─ Docs: http://localhost:${port}/docs`)
}

bootstrap()

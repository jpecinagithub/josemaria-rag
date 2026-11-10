import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { initSchema } from './db.js';
import { registerRoutes } from './routes.js';

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

await app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024 } });
await registerRoutes(app);

if (existsSync(config.staticDir)) {
  await app.register(fastifyStatic, { root: config.staticDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Ruta no encontrada' });
    }
    return reply.sendFile('index.html', config.staticDir);
  });
}

async function boot(retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await initSchema();
      break;
    } catch (err) {
      app.log.warn(`Esperando a la base de datos (${i + 1}/${retries})…`);
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`josemaria-rag backend en ${config.host}:${config.port} (static: ${join(config.staticDir)})`);
}

boot().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

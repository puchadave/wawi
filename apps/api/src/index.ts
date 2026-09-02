import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { client, db } from './db.js';
import { parseMatterhornXmlStream } from './xmlParser.js';
import { upsertProduct } from './importer.js';
import { products } from './schema.js';
import { eq } from 'drizzle-orm';
import { pricingRoutes } from './routes/pricing.js';
import { productRoutes } from './routes/products.js';
import { stockQueue, priceQueue, syncQueue, mediaQueue, feeQueue, syncWorker, mediaWorker, feeWorker } from './queues.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const server = Fastify({
  logger: true,
});

await server.register(cors, {
  origin: process.env.WEB_URL || 'http://localhost:5173',
});

await server.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max for XML upload
  },
});

// Register API routes
await server.register(pricingRoutes);
await server.register(productRoutes);

server.get('/health', async () => {
  try {
    await client`SELECT 1`;
    return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
  } catch (err) {
    server.log.error(err, 'DB connection failed');
    return { status: 'degraded', db: 'disconnected', timestamp: new Date().toISOString() };
  }
});

// Manueller Whitelist XML Upload Endpoint
server.post('/api/import/upload', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'Keine Datei hochgeladen' });
  }

  const tmpPath = path.resolve(__dirname, `../tmp_upload_${Date.now()}.xml`);
  const writeStream = fs.createWriteStream(tmpPath);
  await new Promise<void>((resolve, reject) => {
    data.file.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    data.file.on('error', reject);
  });

  let importedCount = 0;

  try {
    await parseMatterhornXmlStream(tmpPath, async (product) => {
      importedCount++;
      await upsertProduct(product, true); // Mark as whitelisted
    });

    // Cleanup temp file
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    return reply.send({
      message: 'Manueller Whitelist-Import erfolgreich abgeschlossen',
      importedCount,
    });
  } catch (err: any) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    server.log.error(err, 'Fehler beim manuellen XML-Upload');
    return reply.status(500).send({ error: 'Import fehlgeschlagen', details: err.message });
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    console.log(`🚀 API Running on http://${host}:${port}`);

    console.log('BullMQ workers started.');

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
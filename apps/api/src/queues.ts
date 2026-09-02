import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncProductToShopware, type ShopwareSyncJobData } from './shopware/sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const stockQueue = new Queue('stock-updates', { connection: redisConnection });
export const priceQueue = new Queue('price-updates', { connection: redisConnection });
export const syncQueue = new Queue<ShopwareSyncJobData>('shopware-sync', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});
export const mediaQueue = new Queue('media-pipeline', { connection: redisConnection });
export const feeQueue = new Queue('fee-collector', { connection: redisConnection });

export const syncWorker = new Worker<ShopwareSyncJobData>('shopware-sync', async (job) => {
  return syncProductToShopware(job.data, String(job.id));
}, { connection: redisConnection, concurrency: 2 });

export const mediaWorker = new Worker('media-pipeline', async (job) => {
  console.log('Processing media job:', job.id, job.data);
}, { connection: redisConnection });

export const feeWorker = new Worker('fee-collector', async (job) => {
  console.log('Processing fee collector job:', job.id, job.data);
}, { connection: redisConnection });

syncWorker.on('completed', (job) => console.log(`Sync job ${job.id} completed`));
syncWorker.on('failed', (job, error) => console.error(`Sync job ${job?.id} failed:`, error));
mediaWorker.on('completed', (job) => console.log(`Media job ${job.id} completed`));
mediaWorker.on('failed', (job, error) => console.error(`Media job ${job?.id} failed:`, error));
feeWorker.on('completed', (job) => console.log(`Fee job ${job.id} completed`));
feeWorker.on('failed', (job, error) => console.error(`Fee job ${job?.id} failed:`, error));

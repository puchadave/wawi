import { parseMatterhornXmlStream } from '../xmlParser.js';
import { upsertProduct } from '../importer.js';
import { db } from '../db.js';
import { products } from '../schema.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const XML_FILE_PATH = path.resolve(__dirname, '../../../../products_ver2_hard.xml');

async function runFullImport() {
  console.log(`🚀 Starting full XML import from ${XML_FILE_PATH}...`);
  const startTime = Date.now();

  if (!fs.existsSync(XML_FILE_PATH)) {
    console.error(`❌ XML file not found: ${XML_FILE_PATH}`);
    process.exit(1);
  }

  let importedCount = 0;
  let skippedCount = 0;
  let totalParsed = 0;

  try {
    await parseMatterhornXmlStream(XML_FILE_PATH, async (product) => {
      totalParsed++;

      const existing = await db.select({ isWhitelisted: products.isWhitelisted })
        .from(products)
        .where(eq(products.supplierProductId, product.id))
        .limit(1);

      const isWhitelisted = existing.length > 0 && existing[0].isWhitelisted;

      if (isWhitelisted) {
        await upsertProduct(product, true);
        importedCount++;
      } else {
        skippedCount++;
      }

      if (totalParsed % 1000 === 0) {
        console.log(`   ... ${totalParsed} products processed, ${importedCount} imported, ${skippedCount} skipped`);
      }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Vollimport abgeschlossen: ${importedCount} importiert, ${skippedCount} übersprungen (von ${totalParsed} total)`);
    console.log(`⏱️ Dauer: ${duration}s`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Fehler beim Vollimport:', error);
    process.exit(1);
  }
}

runFullImport();

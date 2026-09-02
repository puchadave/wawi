import { parseMatterhornXmlStream } from './xmlParser.js';
import { upsertProduct } from './importer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTestImport() {
  const xmlPath = path.resolve(__dirname, '../../../products_ver2_hard.xml');
  console.log(`Starting test import from ${xmlPath} (first 100 products)...`);

  let count = 0;
  const startTime = Date.now();

  try {
    const result = await parseMatterhornXmlStream(xmlPath, async (product) => {
      count++;
      await upsertProduct(product, true);
      if (count % 20 === 0) {
        console.log(`Imported ${count} products... (latest: ${product.name})`);
      }
      if (count >= 100) {
        throw new Error('STOP_TEST_LIMIT'); // Stop stream after 100 items for test
      }
    });
    console.log(`Import completed! Total: ${result.totalParsed}`);
  } catch (err: any) {
    if (err.message === 'STOP_TEST_LIMIT') {
      console.log(`✅ Test successfully stopped after ${count} products.`);
    } else {
      console.error('❌ Import error:', err);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Finished in ${duration}s.`);
  process.exit(0);
}

runTestImport();

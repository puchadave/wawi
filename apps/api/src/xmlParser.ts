import sax from 'sax';
import fs from 'fs';
import { MatterhornProduct, MatterhornOption } from '@wawi/shared';

export function parseMatterhornXmlStream(
  filePathOrStream: string | fs.ReadStream,
  onProductParsed: (product: MatterhornProduct) => Promise<void>
): Promise<{ totalParsed: number }> {
  return new Promise((resolve, reject) => {
    const stream = typeof filePathOrStream === 'string'
      ? fs.createReadStream(filePathOrStream, { encoding: 'utf8' })
      : filePathOrStream;

    const saxStream = sax.createStream(false, {
      trim: true,
      normalize: true,
      lowercase: true,
      xmlns: false,
    });

    let currentTag = '';
    let currentProduct: Partial<MatterhornProduct> | null = null;
    let currentOption: Partial<MatterhornOption> | null = null;
    let inDescription = false;
    let descriptionText = '';

    let totalParsed = 0;

    saxStream.on('opentag', (node) => {
      currentTag = node.name.toLowerCase();

      if (currentTag === 'product') {
        currentProduct = {
          id: (node.attributes.id as string) || '',
          name: '',
          brand: '',
          categoryPath: '',
          categoryId: '',
          color: '',
          type: '',
          descriptionHtml: '',
          images: [],
          prices: {},
          options: [],
        };
        descriptionText = '';
      } else if (currentTag === 'option' && currentProduct) {
        currentOption = {
          id: (node.attributes.id as string) || '',
          name: '',
          stock: 0,
          availableIn: 0,
          ean: '',
        };
      } else if (currentTag === 'option_name' && currentOption && node.attributes) {
        currentOption.name = (node.attributes.eu || node.attributes.EU || Object.values(node.attributes)[0] || '') as string;
      } else if (currentTag === 'category' && currentProduct && node.attributes.id) {
        currentProduct.categoryId = node.attributes.id as string;
      } else if (currentTag === 'price' && currentProduct && node.attributes.currency) {
        const currency = node.attributes.currency as string;
        if (!currentProduct.prices) currentProduct.prices = {};
        (currentProduct as any)._currentCurrency = currency;
      } else if (currentTag === 'description' && currentProduct) {
        inDescription = true;
      }
    });

    saxStream.on('text', (text) => {
      if (!currentProduct) return;

      if (inDescription) {
        descriptionText += text;
        return;
      }

      switch (currentTag) {
        case 'name':
          currentProduct.name = (currentProduct.name || '') + text;
          break;
        case 'brand':
          currentProduct.brand = (currentProduct.brand || '') + text;
          break;
        case 'category_path':
          currentProduct.categoryPath = (currentProduct.categoryPath || '') + text;
          break;
        case 'category':
          if (!currentProduct.categoryPath) currentProduct.categoryPath = text;
          break;
        case 'color':
          currentProduct.color = (currentProduct.color || '') + text;
          break;
        case 'type':
          currentProduct.type = (currentProduct.type || '') + text;
          break;
        case 'price':
          const curr = (currentProduct as any)._currentCurrency;
          if (curr && currentProduct.prices) {
            const val = parseFloat(text.trim());
            if (!isNaN(val)) {
              currentProduct.prices[curr] = val;
            }
          }
          break;
        case 'image_url':
          if (text.trim() && currentProduct.images) {
            currentProduct.images.push(text.trim());
          }
          break;
        case 'stock':
          if (currentOption) {
            currentOption.stock = parseInt(text.trim(), 10) || 0;
          }
          break;
        case 'avaible_in':
          if (currentOption) {
            currentOption.availableIn = parseInt(text.trim(), 10) || 0;
          }
          break;
        case 'ean':
          if (currentOption) {
            currentOption.ean = text.trim();
          }
          break;
      }
    });

    saxStream.on('cdata', (text) => {
      if (inDescription && currentProduct) {
        descriptionText += text;
      }
    });

    saxStream.on('closetag', async (tagName) => {
      const tag = tagName.toLowerCase();

      if (tag === 'description' && currentProduct) {
        inDescription = false;
        currentProduct.descriptionHtml = descriptionText.trim();
      } else if (tag === 'price' && currentProduct) {
        delete (currentProduct as any)._currentCurrency;
      } else if (tag === 'option' && currentProduct && currentOption) {
        if (currentProduct.options) {
          currentProduct.options.push(currentOption as MatterhornOption);
        }
        currentOption = null;
      } else if (tag === 'product' && currentProduct) {
        totalParsed++;
        const prodToProcess = currentProduct as MatterhornProduct;
        currentProduct = null;

        stream.pause();
        try {
          await onProductParsed(prodToProcess);
          stream.resume();
        } catch (err) {
          stream.destroy();
          saxStream.emit('error', err);
        }
      }
    });

    saxStream.on('end', () => {
      resolve({ totalParsed });
    });

    saxStream.on('error', (err) => {
      reject(err);
    });

    stream.pipe(saxStream);
  });
}

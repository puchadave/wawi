'use strict';
/**
 * WaWi Matterhorn-XML-Parser (Port aus apps/api/src/xmlParser.ts)
 * Dependency-frei — parst das Lieferanten-XML mit Performance-Tracing & kontinuierlichem Debugging.
 */

const { logger } = require('./logger');

/**
 * Tokenizer für XML-Streams & Strings
 */
function tokenize(xml) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/?([a-zA-Z0-9_:.-]+)((?:"[^"]*"|'[^']*'|[^"'<>])*)\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: 'cdata', text: m[1] });
    } else if (m[2] !== undefined) {
      const raw = m[0];
      const name = m[2];
      const isClose = raw.startsWith('</');
      const selfClose = raw.endsWith('/>') && !isClose;
      const attrs = {};
      const attrRe = /([a-zA-Z0-9_:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let am;
      while ((am = attrRe.exec(m[3] || '')) !== null) {
        attrs[am[1].toLowerCase()] = am[3] !== undefined ? am[3] : am[4];
      }
      tokens.push({ type: isClose ? 'close' : 'open', name: name.toLowerCase(), attrs, selfClose });
      if (selfClose) tokens.push({ type: 'close', name: name.toLowerCase(), attrs: {} });
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'text', text: m[4] });
    }
  }
  return tokens;
}

/**
 * Parst das Matterhorn-XML mit kontinuierlichem Tracing
 */
async function parseMatterhornXml(xml, onProduct) {
  const timerLabel = `XML_PARSE_${Date.now()}`;
  logger.time(timerLabel);
  logger.debug('XML_PARSER', `Start Parsing von XML-Payload (${(xml.length / 1024).toFixed(1)} KB)`);

  const tokens = tokenize(xml);
  let totalParsed = 0;
  let i = 0;
  let currentProduct = null;
  let currentOption = null;
  let inDescription = false;
  let descriptionText = '';
  let currentCurrency = null;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === 'open') {
      const tag = t.name;
      if (tag === 'product') {
        currentProduct = {
          id: t.attrs.id || '',
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
      } else if (tag === 'option' && currentProduct) {
        currentOption = { id: t.attrs.id || '', name: '', stock: 0, availableIn: 0, ean: '' };
      } else if (tag === 'option_name' && currentOption) {
        currentOption.name = t.attrs.eu || t.attrs.EU || t.attrs.name || '';
      } else if (tag === 'category' && currentProduct && t.attrs.id) {
        currentProduct.categoryId = t.attrs.id;
      } else if (tag === 'price' && currentProduct && t.attrs.currency) {
        currentCurrency = t.attrs.currency;
      } else if (tag === 'description' && currentProduct) {
        inDescription = true;
      }
    } else if (t.type === 'cdata') {
      if (inDescription && currentProduct) descriptionText += t.text;
    } else if (t.type === 'text') {
      const text = t.text;
      if (!currentProduct) { i++; continue; }
      if (inDescription) {
        descriptionText += text;
        i++; continue;
      }
      const tag = tokens[i - 1] && tokens[i - 1].type === 'open' ? tokens[i - 1].name : '';
      const trimmed = text.trim();
      switch (tag) {
        case 'name':
          if (trimmed) currentProduct.name = (currentProduct.name || '') + trimmed;
          break;
        case 'brand':
          if (trimmed) currentProduct.brand = (currentProduct.brand || '') + trimmed;
          break;
        case 'category_path':
          if (trimmed) currentProduct.categoryPath = (currentProduct.categoryPath || '') + trimmed;
          break;
        case 'category':
          if (!currentProduct.categoryPath && trimmed) currentProduct.categoryPath = trimmed;
          break;
        case 'color':
          if (trimmed) currentProduct.color = (currentProduct.color || '') + trimmed;
          break;
        case 'type':
          if (trimmed) currentProduct.type = (currentProduct.type || '') + trimmed;
          break;
        case 'price': {
          if (currentCurrency && currentProduct.prices) {
            const val = parseFloat(trimmed.replace(',', '.'));
            if (!isNaN(val)) currentProduct.prices[currentCurrency] = val;
          }
          break;
        }
        case 'image_url':
          if (trimmed && currentProduct.images) currentProduct.images.push(trimmed);
          break;
        case 'stock':
          if (currentOption) currentOption.stock = parseInt(trimmed, 10) || 0;
          break;
        case 'avaible_in':
          if (currentOption) currentOption.availableIn = parseInt(trimmed, 10) || 0;
          break;
        case 'ean':
          if (currentOption) currentOption.ean = trimmed;
          break;
        default:
          if (tag === 'option_name' && currentOption && !currentOption.name && trimmed) {
            currentOption.name = trimmed;
          }
      }
    } else if (t.type === 'close') {
      const tag = t.name;
      if (tag === 'description' && currentProduct) {
        inDescription = false;
        currentProduct.descriptionHtml = descriptionText.trim();
      } else if (tag === 'price' && currentProduct) {
        currentCurrency = null;
      } else if (tag === 'option' && currentProduct && currentOption) {
        if (currentOption.id || currentOption.name) {
          currentProduct.options.push(currentOption);
        }
        currentOption = null;
      } else if (tag === 'product' && currentProduct) {
        totalParsed++;
        const prod = currentProduct;
        currentProduct = null;
        if (!prod.images) prod.images = [];
        if (!prod.prices) prod.prices = {};
        if (!prod.options) prod.options = [];
        
        try {
          await onProduct(prod);
        } catch (err) {
          logger.error('XML_PARSER', `Fehler bei Produktverarbeitung (ID: ${prod.id}): ${err.message}`);
        }

        if (totalParsed % 100 === 0) {
          logger.debug('XML_PARSER', `Fortschritt: ${totalParsed} Produkte geparst`);
        }
      }
    }
    i++;
  }

  logger.timeEnd(timerLabel, 'PERF', { totalParsed });
  logger.info('XML_PARSER', `XML-Parsing erfolgreich beendet: ${totalParsed} Produkte verarbeitet.`);

  return { totalParsed };
}

module.exports = { parseMatterhornXml, tokenize };

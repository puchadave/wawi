/**
 * KI-Verarbeitungsprozessoren (ProductProcessor).
 *
 * Jeder Prozessor kapselt EINEN Verarbeitungsschritt (Titel, Beschreibung, SEO, …)
 * und implementiert zwei Dinge:
 *   1. `buildUserPrompt` — den nutzerseitigen Prompt aus dem Produktkontext bauen
 *   2. `parseResult`      — die KI-Antwort in strukturierte ProduktDaten ueberfuehren
 *
 * Es gibt bewusst keine "eine grosse KI-Funktion": Die Pipeline (pipeline.ts)
 * kombiniert unabhaengig aktivierbare Prozessoren.
 */

import type { AiGenerateRequest, AiGenerateResponse } from './adapters.js';

/** Kanonische Produktinhalte, die von der KI erzeugt werden koennen. */
export interface AiProductContent {
  title?: string;
  description?: string;
  metaTitle?: string;
  metaDescription?: string;
  [key: string]: string | undefined;
}

/** Kontext, den die Pipeline einem Prozessor bereitstellt. */
export interface ProcessorContext {
  /** Kanonisches Produkt (DB-Zeile als flaches Objekt). */
  product: Record<string, unknown> & {
    name?: string;
    brand?: string;
    categoryPath?: string;
    categoryId?: string;
    color?: string | null;
    type?: string | null;
    descriptionHtml?: string | null;
    [key: string]: unknown;
  };
  /** Falls ein Uebersetzungsprozessor laeuft: Zielsprache (z. B. "de", "en"). */
  targetLanguage?: string;
  /** Eindeutiger Run-Name fuer die Historie. */
  runName: string;
}

export interface ProcessorOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProductProcessor {
  /** Maschinenname, z. B. "title" (wird in der URL und in aiData verwendet). */
  name: string;
  /** Anzeigename fuer die Oberflaeche. */
  label: string;
  /** Kurzbeschreibung fuer Admins. */
  description: string;
  /** Felder, die dieser Prozessor in den Ergebnisdaten setzen kann. */
  fields: string[];
  buildUserPrompt(context: ProcessorContext): string;
  parseResult(text: string, context: ProcessorContext): AiProductContent;
}

/** Kontrolliertes JSON-Parsen: extrahiert das erste JSON-Objekt aus einer KI-Antwort. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall-through: versuche, ein JSON-Objekt aus dem Text herauszuschneiden
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function productContextBlock(context: ProcessorContext): string {
  const p = context.product;
  const lines = [
    `Name (Original): ${p.name ?? '(leer)'}`,
    `Marke: ${p.brand ?? '(leer)'}`,
    `Kategorie: ${p.categoryPath ?? '(leer)'}`,
    `Farbe: ${p.color ?? '(leer)'}`,
    `Typ: ${p.type ?? '(leer)'}`,
  ];
  if (p.descriptionHtml) {
    lines.push(`Beschreibung (Original): ${String(p.descriptionHtml).slice(0, 5000)}`);
  }
  // Zusaetzliche flache Textfelder für die KI ergänzend bereitstellen
  for (const [key, value] of Object.entries(p)) {
    if (['name', 'brand', 'categoryPath', 'categoryId', 'color', 'type', 'descriptionHtml', 'images', 'prices', 'aiData', 'manualData'].includes(key)) {
      continue;
    }
    if ((typeof value === 'string' || typeof value === 'number') && !key.startsWith('_')) {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

/** Titelgenerierung — knackiger, verkaufsorientierter Produkttitel. */
export const titleProcessor: ProductProcessor = {
  name: 'title',
  label: 'Titelgenerierung',
  description: 'Erzeugt einen optimierten Produkttitel (max. 200 Zeichen).',
  fields: ['title'],
  buildUserPrompt(context) {
    return [
      'Erzeuge einen optimierten Produkttitel für den folgenden Artikel.',
      'Regeln:',
      '- Maximal 200 Zeichen',
      '- Marke und Produktname enthalten',
      '- Verkaufsorientiert, aber sachlich (keine Superlative ohne Substanz)',
      '- Keine Preisangaben',
      '- Antwort ausschliesslich als JSON: {"title": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text);
    const title = json?.title ?? (json && typeof json === 'object' ? String(json.title || '') : '');
    return { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : undefined };
  },
};

/** Beschreibungserstellung — strukturierte Produktbeschreibung aus Rohdaten. */
export const descriptionProcessor: ProductProcessor = {
  name: 'description',
  label: 'Beschreibungserstellung',
  description: 'Erzeugt eine strukturierte HTML-Produktbeschreibung (3–5 Absätze).',
  fields: ['description'],
  buildUserPrompt(context) {
    return [
      'Erstelle eine strukturierte Produktbeschreibung für den folgenden Artikel.',
      'Regeln:',
      '- 3 bis 5 kurze Absätze',
      '- Sachlich und informativ',
      '- Relevante Eigenschaften hervorheben',
      '- Keine Preisangaben, keine Bestellaufrufe',
      '- HTML-Format mit <p>, <ul>, <li> erlaubt',
      '- Antwort ausschliesslich als JSON: {"description": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text);
    const value = json?.description;
    return { description: typeof value === 'string' && value.trim() ? value.trim() : undefined };
  },
};

/** SEO-Optimierung — Meta-Titel und Meta-Beschreibung. */
export const seoProcessor: ProductProcessor = {
  name: 'seo',
  label: 'SEO-Optimierung',
  description: 'Erzeugt Meta-Titel (max. 60 Zeichen) und Meta-Beschreibung (max. 160 Zeichen).',
  fields: ['metaTitle', 'metaDescription'],
  buildUserPrompt(context) {
    return [
      'Optimiere den folgenden Artikel für Suchmaschinen.',
      'Regeln:',
      '- metaTitle: maximal 60 Zeichen',
      '- metaDescription: maximal 160 Zeichen',
      '- Marke und Produktname im Meta-Titel',
      '- Keine Preisangaben, keine Call-to-Actions',
      '- Antwort ausschliesslich als JSON: {"metaTitle": "...", "metaDescription": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text) ?? {};
    return {
      metaTitle: typeof json.metaTitle === 'string' && json.metaTitle.trim() ? json.metaTitle.trim().slice(0, 60) : undefined,
      metaDescription: typeof json.metaDescription === 'string' && json.metaDescription.trim() ? json.metaDescription.trim().slice(0, 160) : undefined,
    };
  },
};

/** Attributextraktion — Farbe/Typ aus Rohdaten ableiten (falls Felder leer sind). */
export const attributesProcessor: ProductProcessor = {
  name: 'attributes',
  label: 'Attributextraktion',
  description: 'Leitet Farbe und Typ aus dem Produktkontext ab (nur wenn Felder leer).',
  fields: ['color', 'type'],
  buildUserPrompt(context) {
    return [
      'Extrahiere Farbe und Typ des folgenden Artikels aus den Rohdaten.',
      'Regeln:',
      '- color: Hauptfarbe (deutsch), z. B. "Schwarz", "Blau" — oder null, falls nicht erkennbar',
      '- type: Produkttyp, z. B. "T-Shirt", "Hoodie" — oder null, falls nicht erkennbar',
      '- Antwort ausschliesslich als JSON: {"color": "...", "type": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text) ?? {};
    return {
      color: typeof json.color === 'string' && json.color.trim() && json.color.trim().toLowerCase() !== 'null'
        ? json.color.trim().slice(0, 50)
        : undefined,
      type: typeof json.type === 'string' && json.type.trim() && json.type.trim().toLowerCase() !== 'null'
        ? json.type.trim().slice(0, 100)
        : undefined,
    };
  },
};

/** Kategorieempfehlung — schlaegt eine Kategorie aus den Rohdaten vor. */
export const categoryProcessor: ProductProcessor = {
  name: 'category',
  label: 'Kategorieempfehlung',
  description: 'Empfiehlt eine normalisierte Kategorie für den Artikel.',
  fields: ['categoryPath', 'categoryId'],
  buildUserPrompt(context) {
    return [
      'Empfiehl eine normalisierte Produktkategorie für den folgenden Artikel.',
      'Regeln:',
      '- categoryPath: Hierarchischer Pfad, z. B. "Bekleidung > T-Shirts"',
      '- categoryId: URL-freundliche Kennung, z. B. "bekleidung-tshirts"',
      '- Antwort ausschliesslich als JSON: {"categoryPath": "...", "categoryId": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text) ?? {};
    return {
      categoryPath: typeof json.categoryPath === 'string' && json.categoryPath.trim() ? json.categoryPath.trim().slice(0, 255) : undefined,
      categoryId: typeof json.categoryId === 'string' && json.categoryId.trim() ? json.categoryId.trim().slice(0, 100) : undefined,
    };
  },
};

/** Übersetzung — uebersetzt Titel/Beschreibung in eine Zielsprache. */
export const translateProcessor: ProductProcessor = {
  name: 'translate',
  label: 'Übersetzung',
  description: 'Übersetzt Titel und Beschreibung in eine Zielsprache (targetLanguage).',
  fields: ['title', 'description'],
  buildUserPrompt(context) {
    const target = context.targetLanguage || 'de';
    return [
      `Übersetze Titel und Beschreibung des folgenden Artikels in die Sprache: "${target}".`,
      'Regeln:',
      '- Nur Übersetzung, keine Ergänzungen',
      '- Keine Preisangaben',
      '- Antwort ausschliesslich als JSON: {"title": "...", "description": "..."}',
      '',
      '--- Produkt ---',
      productContextBlock(context),
    ].join('\n');
  },
  parseResult(text) {
    const json = extractJsonObject(text) ?? {};
    return {
      title: typeof json.title === 'string' && json.title.trim() ? json.title.trim().slice(0, 200) : undefined,
      description: typeof json.description === 'string' && json.description.trim() ? json.description.trim() : undefined,
    };
  },
};

export const ALL_PROCESSORS: ProductProcessor[] = [
  titleProcessor,
  descriptionProcessor,
  seoProcessor,
  attributesProcessor,
  categoryProcessor,
  translateProcessor,
];

export const PROCESSOR_MAP: Record<string, ProductProcessor> = Object.fromEntries(
  ALL_PROCESSORS.map((processor) => [processor.name, processor])
);

export interface CompletedStep {
  processor: string;
  request: AiGenerateRequest;
  response: AiGenerateResponse;
  result: AiProductContent;
}

export type { AiGenerateRequest };
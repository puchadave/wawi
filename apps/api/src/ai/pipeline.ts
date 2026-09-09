/**
 * TransformationPipeline — orchestriert die KI-Verarbeitung eines Produkts.
 *
 * Ablauf:
 *   1. Provider + Modell laden (beide aktiviert)
 *   2. Prompt laden (aktiviert) — Template mit Produktvariablen rendern
 *   3. Jeden angeforderten Prozessor ausfuehren (Titel, Beschreibung, SEO, …)
 *   4. Ergebnis in `aiData` zusammenfuehren (Quelldaten bleiben unangetastet)
 *   5. Nachvollziehbarkeit als `ai_processing_runs.changes` persistieren
 *
 * Prioritaet bleibt: manualData > aiData > Quelldaten — die Pipeline schreibt
 * ausschliesslich `aiData` und nie `manualData` oder Quelldaten.
 */

import { db } from '../db.js';
import {
  aiProviders,
  aiModels,
  aiPrompts,
  aiProcessingRuns,
  products,
  type AiProcessingChange,
} from '../schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { createAiAdapter, type AiProviderConfig, type AiGenerateRequest, AiAdapterError } from './adapters.js';
import {
  PROCESSOR_MAP,
  type AiProductContent,
  type ProductProcessor,
  type ProcessorContext,
  type CompletedStep,
} from './processors.js';

export interface PipelineOptions {
  productId: string;
  /** Namen der Prozessoren, z. B. ["title", "description"] */
  processorNames: string[];
  providerId: string;
  modelId: string;
  promptId?: string | null;
  /** Zielsprache fuer Uebersetzungen (optional). */
  targetLanguage?: string;
  /** Text-Vorgaben fuer die Prozessoren. */
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
}

export type AiRunStatus = 'processing' | 'completed' | 'failed';

export interface PipelineResult {
  runId: string;
  status: AiRunStatus;
  productId: string;
  providerName: string;
  modelName: string;
  promptName: string | null;
  promptVersion: string | null;
  processors: string[];
  changes: AiProcessingChange[];
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: AiProductContent;
  error?: string;
  steps?: CompletedStep[];
}

function renderPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    return variables[name] ?? match;
  });
}

function productVariables(product: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(product)) {
    if (typeof value === 'string') {
      out[key] = value.slice(0, 5000);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}

export async function runProductPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const productRow = await db.select().from(products).where(eq(products.supplierProductId, options.productId)).limit(1);
  if (!productRow.length) {
    throw new Error(`Produkt ${options.productId} nicht gefunden`);
  }
  const product = productRow[0];

  const providerRow = await db.select().from(aiProviders).where(eq(aiProviders.id, options.providerId)).limit(1);
  if (!providerRow.length) {
    throw new Error(`KI-Anbieter ${options.providerId} nicht gefunden`);
  }
  const provider = providerRow[0];
  if (!provider.isEnabled) {
    throw new Error(`KI-Anbieter "${provider.name}" ist deaktiviert`);
  }

  const modelRow = await db.select().from(aiModels).where(eq(aiModels.id, options.modelId)).limit(1);
  if (!modelRow.length) {
    throw new Error(`KI-Modell ${options.modelId} nicht gefunden`);
  }
  const model = modelRow[0];
  if (!model.isEnabled) {
    throw new Error(`KI-Modell "${model.modelName}" ist deaktiviert`);
  }

  let promptRow: (typeof aiPrompts.$inferSelect)[] = [];
  if (options.promptId) {
    promptRow = await db.select().from(aiPrompts).where(eq(aiPrompts.id, options.promptId)).limit(1);
    if (!promptRow.length) {
      throw new Error(`Prompt ${options.promptId} nicht gefunden`);
    }
    if (!promptRow[0].isEnabled) {
      throw new Error(`Prompt "${promptRow[0].name}" ist deaktiviert`);
    }
  }

  const processors: ProductProcessor[] = [];
  for (const name of options.processorNames) {
    const processor = PROCESSOR_MAP[name];
    if (!processor) {
      throw new Error(`Unbekannter Prozessor: "${name}" (verfuegbar: ${Object.keys(PROCESSOR_MAP).join(', ')})`);
    }
    processors.push(processor);
  }
  if (processors.length === 0) {
    throw new Error('Mindestens ein Prozessor muss angegeben werden');
  }

  const runId = uuidv4();
  const variables = productVariables(product);
  const systemPrompt = promptRow.length
    ? renderPromptTemplate(promptRow[0].template, variables)
    : 'Du bist ein professioneller Produktdaten-Spezialist. Antworte ausschliesslich im geforderten JSON-Format.';

  const adapter = createAiAdapter({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    endpoint: provider.endpoint,
    apiKeyEnvVar: provider.apiKeyEnvVar,
  } as AiProviderConfig);

  const inputSnapshot: Record<string, unknown> = {
    aiData: product.aiData ?? {},
    manualData: product.manualData ?? {},
  };

  const context: ProcessorContext = {
    product: { ...product },
    targetLanguage: options.targetLanguage,
    runName: `ai-${options.processorNames.join('+')}`,
  };

  const changes: AiProcessingChange[] = [];
  const outputSnapshot: AiProductContent = { ...(product.aiData ?? {}) };
  const steps: CompletedStep[] = [];

  const requestBase = {
    model: model.modelName,
    systemPrompt,
    temperature: options.options?.temperature ?? 0.3,
    maxTokens: options.options?.maxTokens ?? 2048,
    timeoutMs: options.options?.timeoutMs ?? 60000,
  };

  let runStatus: AiRunStatus = 'processing';
  let errorMessage: string | null = null;

  try {
    for (const processor of processors) {
      const userPrompt = processor.buildUserPrompt(context);
      const request: AiGenerateRequest = { ...requestBase, userPrompt };
      const response = await adapter.generate(request);
      const result = processor.parseResult(response.text, context);

      steps.push({ processor: processor.name, request, response, result });

      for (const field of processor.fields) {
        const modified = result[field];
        if (modified === undefined) continue;
        const original = outputSnapshot[field];
        if (original === modified) continue;
        outputSnapshot[field] = modified;
        changes.push({
          field,
          originalValue: typeof original === 'string' ? original : original ?? null,
          modifiedValue: modified,
          processor: processor.name,
          model: model.modelName,
          promptVersion: promptRow.length ? promptRow[0].version : 'default',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Nur bei mindestens einer Aenderung aiData aktualisieren (Quelldaten/manualData bleiben unangetastet)
    if (changes.length > 0) {
      await db.update(products)
        .set({ aiData: outputSnapshot, updatedAt: new Date() })
        .where(eq(products.supplierProductId, options.productId));
    }

    runStatus = 'completed';
  } catch (err) {
    runStatus = 'failed';
    errorMessage = err instanceof AiAdapterError
      ? `${err.message}${err.providerBody ? ` — ${err.providerBody.slice(0, 300)}` : ''}`
      : (err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await db.insert(aiProcessingRuns).values({
      id: runId,
      productId: options.productId,
      modelId: model.id,
      promptId: promptRow.length ? promptRow[0].id : null,
      runName: context.runName,
      changes,
      inputSnapshot,
      outputSnapshot,
      status: runStatus,
      error: errorMessage,
      startedAt: new Date(),
      completedAt: runStatus === 'processing' ? null : new Date(),
    });
  }

  return {
    runId,
    status: runStatus,
    productId: options.productId,
    providerName: provider.name,
    modelName: model.modelName,
    promptName: promptRow.length ? promptRow[0].name : null,
    promptVersion: promptRow.length ? promptRow[0].version : null,
    processors: options.processorNames,
    changes,
    inputSnapshot,
    outputSnapshot,
    steps,
  };
}
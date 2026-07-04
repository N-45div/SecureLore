import { CohereClientV2 } from "cohere-ai";

export type CohereEmbedInputType = "search_document" | "search_query" | "classification" | "clustering";

export interface EmbeddingProvider {
  embedTexts(texts: string[], inputType: CohereEmbedInputType): Promise<number[][]>;
}

export class CohereEmbeddingProvider implements EmbeddingProvider {
  private readonly client: CohereClientV2;
  private readonly model: string;
  private readonly outputDimension: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    outputDimension?: number;
  }) {
    this.client = new CohereClientV2({ token: options.apiKey });
    this.model = options.model ?? "embed-v4.0";
    this.outputDimension = options.outputDimension ?? 1024;
  }

  async embedTexts(texts: string[], inputType: CohereEmbedInputType): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embed({
      texts,
      model: this.model,
      inputType,
      outputDimension: this.outputDimension,
      embeddingTypes: ["float"]
    });

    const floats = response.embeddings?.float;
    if (!floats || floats.length !== texts.length) {
      throw new Error("Cohere returned an unexpected embedding response.");
    }

    return floats;
  }
}

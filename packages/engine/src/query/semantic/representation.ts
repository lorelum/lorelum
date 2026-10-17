export interface EmbeddingInput {
  readonly inputKey: string;
  readonly channel: string;
  readonly ordinal: number;
  readonly text: string;
  readonly inputDigest: string;
}

export interface PracticeVectorProjection {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly projectionDigest: string;
  readonly inputs: readonly EmbeddingInput[];
}

export interface DocumentVector {
  readonly inputKey: string;
  readonly channel: string;
  readonly ordinal: number;
  readonly embedding: Float32Array;
}

export interface QueryEmbeddingInput {
  readonly inputKey: string;
  readonly text: string;
  readonly weight: number;
}

export interface QueryVector {
  readonly inputKey: string;
  readonly embedding: Float32Array;
  readonly weight: number;
}

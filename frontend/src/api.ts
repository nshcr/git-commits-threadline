import type { ChunkData, GraphMeta } from './types';

export async function fetchMeta(): Promise<GraphMeta> {
  const response = await fetch('data/meta.json');
  if (!response.ok) throw new Error('Failed to load graph metadata');
  return response.json();
}

export async function fetchChunk(filename: string): Promise<ChunkData> {
  const response = await fetch(`data/${ filename }`);
  if (!response.ok) throw new Error(`Failed to load chunk: ${ filename }`);
  return response.json();
}

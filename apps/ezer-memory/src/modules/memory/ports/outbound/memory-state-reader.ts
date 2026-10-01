export interface MemoryStateReader {
  read(individualId: string): Promise<{ readonly changeSequence: number }>;
}

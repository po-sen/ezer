interface MemoryServiceDescription {
  readonly name: "ezer-memory";
  readonly version: string;
  readonly stage: "foundation";
  readonly capabilities: {
    readonly memoryRead: true;
    readonly memoryWrite: true;
    readonly memorySearch: true;
    readonly memoryRecent: true;
    readonly memoryExport: true;
  };
}

export interface DescribeMemoryService {
  execute(): MemoryServiceDescription;
}

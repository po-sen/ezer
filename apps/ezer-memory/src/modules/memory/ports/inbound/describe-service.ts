interface MemoryServiceDescription {
  readonly name: "ezer-memory";
  readonly version: string;
  readonly stage: "foundation";
  readonly capabilities: {
    readonly memoryRead: true;
    readonly memoryWrite: true;
  };
}

export interface DescribeMemoryService {
  execute(): MemoryServiceDescription;
}

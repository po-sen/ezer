interface MemoryServiceDescription {
  readonly name: "ezer-memory";
  readonly version: string;
  readonly stage: "foundation";
  readonly capabilities: {
    readonly memoryRead: false;
    readonly memoryWrite: false;
  };
}

export interface DescribeMemoryService {
  execute(): MemoryServiceDescription;
}

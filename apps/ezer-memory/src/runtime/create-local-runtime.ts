interface Resource {
  close(): void | Promise<void>;
}

export function createLocalRuntime(
  compose: (own: <T extends Resource>(resource: T) => T) => Promise<Resource>,
) {
  const resources: Resource[] = [];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      let failed = false;
      for (const resource of resources.reverse()) {
        try {
          await resource.close();
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error("Local Ezer cleanup failed");
    })());
  return {
    async start() {
      try {
        resources.push(
          await compose((resource) => {
            resources.push(resource);
            return resource;
          }),
        );
      } catch {
        await close();
        throw new Error("Local Ezer initialization failed");
      }
      const stop = () => {
        void close().catch(() => {
          process.exitCode = 1;
        });
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      process.stdin.once("end", stop);
    },
    close,
  };
}

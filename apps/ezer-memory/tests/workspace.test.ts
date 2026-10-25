import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openWorkspace } from "../src/modules/workspace/infrastructure/persistence/sqlite/index.ts";
import {
  createWorkspaceOperations,
  createConnectWorkspace,
} from "../src/modules/workspace/application/index.ts";
import { createWorkspaceAccessGateway } from "../src/modules/workspace/infrastructure/acl/access/index.ts";
import { createWorkspaceFingerprint } from "../src/modules/workspace/infrastructure/index.ts";
import {
  WorkspacePersistenceFault,
  type WorkspaceStore,
} from "../src/modules/workspace/ports/outbound/index.ts";
import { createLocalProcessVerifier } from "../src/modules/access/infrastructure/local-process/index.ts";
import { createAccessControl } from "../src/modules/access/application/index.ts";
import { createSqliteUnitOfWork } from "../src/modules/memory/infrastructure/persistence/sqlite/node/index.ts";

const migrations = fileURLToPath(
  new URL(
    "../src/modules/workspace/infrastructure/persistence/sqlite/migrations/",
    import.meta.url,
  ),
);
const connection = {
  individualId: "alpha",
  capabilities: { read: true, write: true },
};
const now = () => "2026-10-25T00:00:00.000Z";
const note = {
  kind: "write" as const,
  operationId: "create",
  fileId: "note",
  expectedVersion: 0,
  path: "notes/a.md",
  content: new TextEncoder().encode("Synthetic evidence"),
  mediaType: "text/plain",
};
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ezer-workspace-"));
  const store = openWorkspace(join(root, "workspace.sqlite"), migrations);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(await store.status(), {
    currentVersion: 0,
    targetVersion: 1,
    pending: 1,
  });
  await store.up();
  store.initialize("alpha");
  return {
    store,
    root,
    operations: createWorkspaceOperations(
      connection,
      store.unitOfWork,
      createWorkspaceFingerprint(),
      now,
    ),
  };
}

test("file writes, operation receipts and current pointers roll back together", async (t) => {
  const { store, operations } = await fixture(t);
  const failing = createWorkspaceOperations(
    connection,
    {
      within(work) {
        return store.unitOfWork.within((scoped) =>
          work({
            ...scoped,
            record(...args) {
              scoped.record(...args);
              throw new WorkspacePersistenceFault();
            },
          }),
        );
      },
    },
    createWorkspaceFingerprint(),
    now,
  );
  assert.deepEqual(await failing.mutate(note), {
    ok: false,
    code: "UNAVAILABLE",
  });
  assert.deepEqual(operations.list({}), {
    ok: true,
    value: { files: [], nextCursor: null },
  });
  assert.equal((await operations.mutate(note)).ok, true);
  store.unitOfWork.within((scoped) => {
    assert.equal(scoped.state().changeSequence, 1);
    assert.equal(scoped.receipt("create")?.version, 1);
  });
});

test("transaction capabilities expire, nested/async work is rejected and both SQLite contexts remain usable", async (t) => {
  const { store } = await fixture(t);
  let escaped: WorkspaceStore | undefined;
  store.unitOfWork.within((scoped) => {
    escaped = scoped;
  });
  assert.throws(() => escaped!.state(), /Expired/);
  assert.throws(
    () => store.unitOfWork.within(() => store.unitOfWork.within(() => null)),
    /Nested/,
  );
  // Deliberately exercise the runtime guard against untyped callers.
  assert.throws(
    () => store.unitOfWork.within((() => Promise.resolve(null)) as never),
    /synchronous/,
  );
  assert.equal(
    store.unitOfWork.within((scoped) => scoped.state().changeSequence),
    0,
  );
  const memoryDatabase = new DatabaseSync(":memory:");
  t.after(() => memoryDatabase.close());
  const memory = createSqliteUnitOfWork(memoryDatabase);
  assert.throws(() => memory.within(() => memory.within(() => null)), /Nested/);
  assert.throws(
    () => memory.within((() => Promise.resolve(null)) as never),
    /synchronous/,
  );
  assert.equal(
    memory.within(() => 42),
    42,
  );
});

test("workspace permissions are enforced before persistence and Access translations preserve identity", async (t) => {
  const { store } = await fixture(t);
  const denied = createWorkspaceOperations(
    { ...connection, capabilities: { read: false, write: false } },
    {
      within() {
        throw new Error("Must not reach storage");
      },
    },
    createWorkspaceFingerprint(),
    now,
  );
  assert.deepEqual(await denied.mutate(note), {
    ok: false,
    code: "WRITE_NOT_GRANTED",
  });
  assert.deepEqual(denied.list({}), { ok: false, code: "READ_NOT_GRANTED" });
  assert.deepEqual(denied.history({ fileId: "note" }), {
    ok: false,
    code: "READ_NOT_GRANTED",
  });
  assert.deepEqual(denied.read({ fileId: "note" }), {
    ok: false,
    code: "READ_NOT_GRANTED",
  });
  const verifier = createLocalProcessVerifier("alpha", false);
  assert.deepEqual(await verifier.verify("browser-assertion"), {
    status: "unrecognized",
  });
  const access = createAccessControl(
    {
      read: () => ({
        assignments: [{ callerId: "local-process", individualId: "alpha" }],
      }),
    },
    verifier,
  );
  const connected = await createConnectWorkspace(
    createWorkspaceAccessGateway(access),
  ).execute();
  assert.deepEqual(connected, { ok: true, value: connection });
  const changed = createAccessControl(
    {
      read: () => ({
        assignments: [{ callerId: "local-process", individualId: "beta" }],
      }),
    },
    verifier,
  );
  assert.deepEqual(
    await createConnectWorkspace(
      createWorkspaceAccessGateway(changed),
    ).execute(),
    { ok: false, code: "UNAVAILABLE" },
  );
  const foreign = createWorkspaceOperations(
    { ...connection, individualId: "beta" },
    store.unitOfWork,
    createWorkspaceFingerprint(),
    now,
  );
  assert.deepEqual(foreign.list({}), { ok: false, code: "UNAVAILABLE" });
  assert.throws(() => store.initialize("beta"), /identity mismatch/);
  assert.equal(
    store.unitOfWork.within((scoped) => scoped.state().individualId),
    "alpha",
  );
});

test("mutation snapshots bytes before awaiting fingerprint work and canonical retries survive later changes", async (t) => {
  const { store } = await fixture(t);
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fingerprint = createWorkspaceFingerprint();
  const operations = createWorkspaceOperations(
    connection,
    store.unitOfWork,
    {
      async digest(metadata, content) {
        await waiting;
        return fingerprint.digest(metadata, content);
      },
    },
    now,
  );
  const bytes = new TextEncoder().encode("Original");
  const command = { ...note, content: bytes };
  const pending = operations.mutate(command);
  bytes.fill(0);
  command.path = "changed.md";
  release!();
  const created = await pending;
  assert.equal(created.ok, true);
  const read = operations.read({ fileId: "note" });
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(new TextDecoder().decode(read.value.content), "Original");
    assert.equal(read.value.file.path, "notes/a.md");
  }
  await operations.mutate({
    kind: "trash",
    fileId: "note",
    operationId: "trash",
    expectedVersion: 1,
  });
  assert.deepEqual(
    await operations.mutate({
      ...note,
      content: new TextEncoder().encode("Original"),
    }),
    created,
  );
});

test("a process killed before commit leaves no partial file, head, sequence or receipt", async (t) => {
  const { root, store, operations } = await fixture(t);
  const adapter = new URL(
    "../src/modules/workspace/infrastructure/persistence/sqlite/index.ts",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    import { createWorkspaceUnitOfWork } from ${JSON.stringify(adapter)};
    const db = new DatabaseSync(${JSON.stringify(join(root, "workspace.sqlite"))});
    createWorkspaceUnitOfWork(db).within(store => {
      store.append({ fileId: "note", version: 1, path: "notes/a.md", content: new Uint8Array([42]), mediaType: "text/plain", deleted: false, changedAt: "2026-10-25T00:00:00.000Z", changeSequence: 1 });
      store.record("create", "synthetic-fingerprint", "note", 1);
      process.kill(process.pid, "SIGKILL");
    });
  `,
    ],
    { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin" } },
  );
  assert.equal(child.signal, "SIGKILL");
  store.unitOfWork.within((scoped) => {
    assert.equal(scoped.state().changeSequence, 0);
    assert.equal(scoped.read("note"), null);
    assert.equal(scoped.receipt("create"), null);
  });
  assert.equal((await operations.mutate(note)).ok, true);
});

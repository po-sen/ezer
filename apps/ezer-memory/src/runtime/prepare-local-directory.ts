import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";

export function prepareLocalDirectory(
  individualId: string,
  dataDirectory?: string,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(individualId))
    throw new Error("Invalid local individual");
  const root = dataDirectory ?? join(homedir(), ".ezer", "individuals");
  if (!isAbsolute(root) || resolve(root) !== root)
    throw new Error("Data directory must be canonical and absolute");
  function inspect(path: string, directory: boolean, owned: boolean) {
    const info = lstatSync(path);
    if (
      info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    )
      throw new Error("Unsafe data path");
    if (
      owned &&
      process.platform !== "win32" &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    )
      throw new Error("Data must be private to the current OS user");
  }
  let current = parse(root).root;
  for (const part of root
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    inspect(current, true, false);
  }
  inspect(root, true, true);
  const directory = join(root, individualId);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  inspect(directory, true, true);
  function database(name: string) {
    const path = join(directory, name);
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    inspect(path, false, true);
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        inspect(path + suffix, false, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return path;
  }
  return {
    memory: database("memory.sqlite"),
    workspace: database("workspace.sqlite"),
  };
}

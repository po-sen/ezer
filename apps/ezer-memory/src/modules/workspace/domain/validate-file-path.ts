import { WorkspaceFault } from "./workspace-fault.ts";

export function validateFilePath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 512 ||
    /[\uD800-\uDFFF]/u.test(path) ||
    path !== path.normalize("NFC") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part.length > 128 ||
          part === "." ||
          part === ".." ||
          /[\x00-\x1f\x7f<>:"\\|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new WorkspaceFault("INVALID_INPUT");
}

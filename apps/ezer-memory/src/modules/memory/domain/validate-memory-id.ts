import { MemoryFault } from "./memory-fault.ts";
export function validateMemoryId(value: string): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    throw new MemoryFault("INVALID_INPUT");
}

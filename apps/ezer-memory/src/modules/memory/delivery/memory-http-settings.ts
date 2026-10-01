export interface MemoryHttpSettings {
  readonly resource: string;
  readonly authorizationServer: string;
  readonly connectionScope: string;
  readonly readScope: string;
  readonly writeScope: string;
}

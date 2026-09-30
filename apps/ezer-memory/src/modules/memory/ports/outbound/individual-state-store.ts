interface IndividualState {
  readonly individualId: string;
  readonly changeSequence: number;
}
export interface IndividualStateStore {
  read(): IndividualState;
  advance(expectedSequence: number, nextSequence: number): void;
}

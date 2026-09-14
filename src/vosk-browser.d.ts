declare module "vosk-browser" {
  export type VoskMessage<T> = { event: string; result: T };

  export class KaldiRecognizer {
    constructor(sampleRate?: number);
    setWords(words: boolean): void;
    acceptWaveform(buffer: AudioBuffer): void;
    on(
      event: "partialresult",
      listener: (message: { result: { partial: string } }) => void,
    ): void;
    on(
      event: "result",
      listener: (message: { result: { text: string } }) => void,
    ): void;
  }

  export class Model {
    ready: boolean;
    KaldiRecognizer: typeof KaldiRecognizer;
    on(event: "load", listener: () => void): void;
    terminate(): void;
  }

  export function createModel(modelUrl: string, logLevel?: number): Promise<Model>;
}

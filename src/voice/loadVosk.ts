type CreateModel = (modelUrl: string, logLevel?: number) => Promise<{
  KaldiRecognizer: new (
    sampleRate: number,
    grammar?: string,
  ) => {
    on(event: string, cb: (msg: { result: { partial?: string; text?: string } }) => void): void;
    acceptWaveform(buffer: AudioBuffer): void;
  };
  terminate: () => void;
}>;

function pickCreateModel(mod: unknown): CreateModel | null {
  if (!mod || typeof mod !== "object") return null;
  const root = mod as Record<string, unknown>;

  const candidates = [root, root.default, root["module.exports"]];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "function") return c as CreateModel;
    if (typeof c === "object") {
      const fn = (c as Record<string, unknown>).createModel;
      if (typeof fn === "function") return fn as CreateModel;
    }
  }
  return null;
}

export async function loadVoskCreateModel(): Promise<CreateModel> {
  const mod = await import("vosk-browser");
  const createModel = pickCreateModel(mod);
  if (createModel) return createModel;

  
  const umd = await import("vosk-browser/dist/vosk.js");
  const fromUmd = pickCreateModel(umd);
  if (fromUmd) return fromUmd;

  console.error("[dubina:vosk] unexpected module", mod, umd);
  throw new Error("vosk-browser: createModel недоступен");
}

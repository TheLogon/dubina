export type MicPermissionState = "granted" | "denied" | "prompt" | "unavailable";

export async function getMicrophonePermissionState(): Promise<MicPermissionState> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state === "granted") return "granted";
      if (status.state === "denied") return "denied";
      return "prompt";
    }
    return "prompt";
  } catch {
    return "prompt";
  }
}

export async function requestMicrophoneAccess(
  inputDeviceId = "",
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Микрофон недоступен в этой среде");
  }

  const base: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const attempts: Array<MediaTrackConstraints | boolean> = [];
  if (inputDeviceId) {
    attempts.push({ ...base, deviceId: { ideal: inputDeviceId } });
    attempts.push({
      channelCount: 1,
      deviceId: { ideal: inputDeviceId },
    });
    attempts.push({ deviceId: { ideal: inputDeviceId } });
    attempts.push({ ...base, deviceId: { exact: inputDeviceId } });
  }
  attempts.push(base);
  attempts.push({ channelCount: 1 });
  attempts.push(true);

  let lastError: unknown;
  for (const audio of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Не удалось получить микрофон");
}

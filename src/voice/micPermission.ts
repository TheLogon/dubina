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

  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
  };
  if (inputDeviceId) {
    audio.deviceId = { exact: inputDeviceId };
  }

  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

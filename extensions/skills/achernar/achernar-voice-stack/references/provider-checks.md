# Provider Checks

1. Confirm the base URL uses HTTP(S), has no embedded credentials, and resolves to the intended host.
2. Probe `/models` without a key; `401` or `403` proves transport reachability and authentication enforcement, not model permission.
3. For ASR, validate RIFF/WAVE headers, channels, sample rate, bit depth, and duration before inference.
4. For TTS voice cloning, send `data:audio/wav;base64,...` only through encrypted application storage and verify the returned WAV header.
5. Remove secrets from thrown errors, activity events, and artifacts.

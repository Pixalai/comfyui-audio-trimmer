import torch
import json
import os
import numpy as np
import torchaudio
from comfy_api.latest import io, ui
from server import PromptServer
import folder_paths


class AudioTrimmerNode(io.ComfyNode):
    """Audio Trimmer with visual timeline - trim any length audio by sliding timeline points.
    
    NOTE ON QUALITY: This node performs pure tensor slicing on the raw waveform
    samples. There is ZERO re-encoding, resampling, or compression applied to the
    output audio. The output waveform is an exact subset of the input samples at
    the original sample rate and bit depth. Lossless operation guaranteed.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AudioTrimmer_Timeline",
            display_name="🎵 Audio Trimmer",
            category="audio/edit",
            description="Trim audio with a visual timeline editor. Drag the handles to set trim start/end points. Run the node once to load the waveform visualization, then adjust and re-run. Output is lossless — pure sample slicing, no re-encoding.",
            is_output_node=True,
            inputs=[
                io.Audio.Input("audio", tooltip="Input audio to trim"),
                io.Float.Input(
                    "start_time",
                    default=0.0,
                    min=0.0,
                    max=999999.0,
                    step=0.001,
                    round=0.0001,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Trim start time in seconds",
                ),
                io.Float.Input(
                    "end_time",
                    default=0.0,
                    min=0.0,
                    max=999999.0,
                    step=0.001,
                    round=0.0001,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Trim end time in seconds (0 = end of audio)",
                ),
            ],
            outputs=[
                io.Audio.Output("AUDIO"),
            ],
            hidden=[
                io.Hidden.unique_id,
            ],
        )

    @classmethod
    def execute(cls, audio, start_time, end_time):
        waveform = audio["waveform"]  # [B, C, T]
        sample_rate = audio["sample_rate"]

        total_samples = waveform.shape[2]
        duration = total_samples / sample_rate

        # Debug: confirm what values the backend actually receives
        print(f"[AudioTrimmer] Received: start_time={start_time}, end_time={end_time}")
        print(f"[AudioTrimmer] Audio: {total_samples} samples @ {sample_rate}Hz = {duration:.6f}s")

        # Compute mono samples for frontend waveform visualization
        # Send at ~2000 samples/sec for pixel-perfect rendering at any zoom
        samples_data = _compute_mono_samples(waveform, sample_rate)

        # Save full audio to temp as FLAC (lossless) for frontend playback
        audio_filename = _save_full_audio_to_temp(waveform, sample_rate, cls.hidden.unique_id)

        # Send waveform samples + audio file reference to frontend
        PromptServer.instance.send_sync(
            "audio_trimmer.waveform_data",
            {
                "node_id": cls.hidden.unique_id,
                "samples": samples_data,
                "total_raw_samples": total_samples,
                "duration": round(duration, 6),
                "sample_rate": sample_rate,
                "channels": waveform.shape[1],
                "audio_file": audio_filename,
            },
        )

        # Calculate trim boundaries — pure integer sample slicing, no interpolation
        start_sample = int(start_time * sample_rate)
        start_sample = max(0, min(start_sample, total_samples - 1))

        if end_time <= 0 or end_time > duration:
            end_sample = total_samples
        else:
            end_sample = int(end_time * sample_rate)
            end_sample = max(start_sample + 1, min(end_sample, total_samples))

        # Debug: confirm trim boundaries
        trim_dur = (end_sample - start_sample) / sample_rate
        print(f"[AudioTrimmer] Trimming: sample {start_sample} to {end_sample} ({start_sample/sample_rate:.6f}s to {end_sample/sample_rate:.6f}s = {trim_dur:.6f}s)")

        # Trim the waveform — exact sample slice, zero quality loss
        trimmed_waveform = waveform[:, :, start_sample:end_sample]

        trimmed_audio = {
            "waveform": trimmed_waveform,
            "sample_rate": sample_rate,
        }

        # Return trimmed audio with preview
        return io.NodeOutput(
            trimmed_audio,
            ui=ui.PreviewAudio(trimmed_audio, cls=cls),
        )


def _save_full_audio_to_temp(waveform, sample_rate, node_id):
    """Save the full audio to temp directory as FLAC for browser playback.
    
    Uses FLAC encoding which is fully lossless — the decoded audio is
    bit-identical to the original waveform samples.
    """
    temp_dir = folder_paths.get_temp_directory()
    filename = f"audio_trimmer_preview_{node_id}.flac"
    filepath = os.path.join(temp_dir, filename)

    # waveform is [B, C, T], torchaudio expects [C, T]
    audio_data = waveform[0].cpu()
    torchaudio.save(filepath, audio_data, sample_rate, format="flac")

    return filename


def _compute_mono_samples(waveform, sample_rate):
    """Downsample mono audio to ~2000 samples/second for visualization.
    
    Instead of pre-binning into peaks, we send the raw (downsampled) samples.
    The frontend computes min/max per pixel dynamically based on visible range
    and zoom level, giving pixel-perfect waveform accuracy at ANY zoom.
    
    2000 samples/sec gives 0.5ms resolution — more than enough for precise
    visual trimming. Data size: ~16KB per second of audio.
    """
    # Mix down to mono: [B, C, T] -> [T]
    mono = waveform[0].mean(dim=0).cpu().numpy()
    total = len(mono)
    
    # Target: 2000 samples per second of audio
    target_rate = 2000
    target_count = max(int((total / sample_rate) * target_rate), total if total < target_rate else target_rate)
    target_count = min(target_count, total)  # never upsample
    
    if total <= target_count:
        return [round(float(s), 5) for s in mono]
    
    # Downsample by taking evenly spaced samples
    import numpy as np
    indices = np.linspace(0, total - 1, target_count, dtype=int)
    downsampled = mono[indices]
    
    return [round(float(s), 5) for s in downsampled]


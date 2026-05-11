# ComfyUI Audio Trimmer ✂️🎵

A precision audio trimming node for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) with a visual timeline editor — trim any audio directly in your workflow with sample-accurate precision.

![ComfyUI Audio Trimmer](https://img.shields.io/badge/ComfyUI-Custom_Node-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Visual Timeline Editor** — Premiere Pro-style waveform display with interactive trim handles
- **Sample-Accurate Trimming** — Pure tensor slicing, zero re-encoding or quality loss
- **Precision Zoom** — Up to 500x zoom with millisecond-level time markers for surgical edits
- **In-Node Playback** — Preview the selected audio section using Web Audio API (sample-accurate playback)
- **Mouse-Anchored Zoom** — Ctrl+Scroll zooms centered on your cursor position
- **Lossless Pipeline** — No compression, resampling, or bit-depth changes at any stage

## Installation

### ComfyUI Manager
Search for `comfyui-audio-trimmer` in ComfyUI Manager and click Install.

### Manual Installation
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Pixalai/comfyui-audio-trimmer.git
```

No additional dependencies required — uses only built-in ComfyUI/PyTorch modules.

## Usage

1. Connect any `AUDIO` output to the Audio Trimmer node
2. **Queue the workflow** to load the waveform visualization
3. **Drag the green (start) and red (end) handles** to set your trim region
4. **Click ▶ Play** to preview the selected section
5. **Queue again** to output the trimmed audio

### Controls

| Action | What it does |
|--------|-------------|
| **Drag handles** | Set trim start/end points |
| **Drag region** | Move the entire selection |
| **Double-click** | Jump nearest handle to click position |
| **Scroll** | Pan the timeline |
| **Ctrl+Scroll** | Zoom in/out (anchored to cursor) |
| **▶ Play / ■ Stop** | Preview selected audio section |
| **+/−/Reset** | Zoom controls |

## Audio Quality

This node guarantees **zero quality degradation**:

| Stage | Operation | Quality Impact |
|-------|-----------|---------------|
| Input | Raw `AUDIO` tensor `[B, C, T]` | Original samples |
| Trimming | `waveform[:, :, start:end]` | **Zero loss** — exact sample slice |
| Output | Same tensor, same sample rate | **Bit-identical** to input section |
| Preview | FLAC (lossless) + Web Audio API | **Bit-identical** decode & playback |

## Requirements

- ComfyUI (latest version recommended)
- Python 3.10+
- PyTorch
- torchaudio

## License

MIT License — see [LICENSE](LICENSE) for details.

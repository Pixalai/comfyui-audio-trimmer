from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .nodes import AudioTrimmerNode

WEB_DIRECTORY = "./js"

class AudioTrimmerExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [AudioTrimmerNode]


async def comfy_entrypoint() -> AudioTrimmerExtension:
    return AudioTrimmerExtension()

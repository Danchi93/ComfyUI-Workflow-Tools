from .multi_lora_loader import MultiLoraLoader
from .prompt_segments import PromptSegments
from .resolution_switcher import ResolutionSwitcher

NODE_CLASS_MAPPINGS = {
    "MultiLoraLoader": MultiLoraLoader,
    "PromptSegments": PromptSegments,
    "ResolutionSwitcher": ResolutionSwitcher,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiLoraLoader": "Multi LoRA Loader",
    "PromptSegments": "Prompt Segments",
    "ResolutionSwitcher": "Resolution Switcher",
}
WEB_DIRECTORY = "."
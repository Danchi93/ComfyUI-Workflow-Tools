from .multi_lora_loader import MultiLoraLoader
from .prompt_segments import PromptSegments
from .resolution_switcher import ResolutionSwitcher
from .img2img_txt2img_switch import Img2ImgTxt2ImgSwitch

NODE_CLASS_MAPPINGS = {
    "MultiLoraLoader": MultiLoraLoader,
    "PromptSegments": PromptSegments,
    "ResolutionSwitcher": ResolutionSwitcher,
    "Img2ImgTxt2ImgSwitch": Img2ImgTxt2ImgSwitch,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiLoraLoader": "Multi LoRA Loader",
    "PromptSegments": "Prompt Segments",
    "ResolutionSwitcher": "Resolution Switcher",
    "Img2ImgTxt2ImgSwitch": "img2img / txt2img Switch",
}
WEB_DIRECTORY = "."
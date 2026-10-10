from .py.multi_lora_loader import MultiLoraLoader
from .py.prompt_segments import PromptSegments
from .py.resolution_switcher import ResolutionSwitcher
from .py.img2img_txt2img_switch import Img2ImgTxt2ImgSwitch
from .py.prompt_extractor import PromptExtractor
from .py.load_video_frame import VideoFrameExtractor

NODE_CLASS_MAPPINGS = {
    "MultiLoraLoader": MultiLoraLoader,
    "PromptSegments": PromptSegments,
    "ResolutionSwitcher": ResolutionSwitcher,
    "Img2ImgTxt2ImgSwitch": Img2ImgTxt2ImgSwitch,
    "PromptExtractor": PromptExtractor,
    "VideoFrameExtractor": VideoFrameExtractor,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiLoraLoader": "Multi LoRA Loader",
    "PromptSegments": "Prompt Segments",
    "ResolutionSwitcher": "Resolution Switcher",
    "Img2ImgTxt2ImgSwitch": "img2img / txt2img Switch",
    "PromptExtractor": "Prompt Extractor",
    "VideoFrameExtractor": "Video Frame Extractor",
}
WEB_DIRECTORY = "js"

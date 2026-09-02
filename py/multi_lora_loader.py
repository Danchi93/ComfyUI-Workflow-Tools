import os, json
import comfy.utils, comfy.sd, folder_paths

class MultiLoraLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_stack": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "clip": ("CLIP",),   # 可选：接入后支持含 text encoder 权重的 LoRA
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "triggers")
    FUNCTION = "apply"
    CATEGORY = "loaders"
    SEARCH_ALIASES = ["multi lora", "lora stack", "workflow tools", "多LoRA", "LoRA堆叠", "工作流工具"]

    def apply(self, model, lora_stack="[]", clip=None):
        try:
            stack = json.loads(lora_stack)
        except Exception:
            return (model, clip, "")

        triggers = []
        for entry in stack:
            if not entry.get("enabled", False):
                continue
            lora_name = entry.get("lora", "None")
            strength = float(entry.get("strength", 1.0))
            if lora_name == "None" or strength == 0:
                continue
            path = folder_paths.get_full_path("loras", lora_name)
            if path and os.path.exists(path):
                lora = comfy.utils.load_torch_file(path)
                # clip 为 None 时 load_lora_for_models 会自动跳过 CLIP 部分
                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength, strength)
            trigger = entry.get("trigger", "").strip()
            if trigger:
                triggers.append(trigger)

        trigger_out = ", " + ", ".join(triggers) + ", " if triggers else ""

        return (model, clip, trigger_out)
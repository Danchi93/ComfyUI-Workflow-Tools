import os, json
import comfy.utils, comfy.sd, folder_paths

class MultiLoraLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_stack": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply"
    CATEGORY = "loaders"
    SEARCH_ALIASES = ["multi lora", "lora stack", "workflow tools", "多LoRA", "LoRA堆叠", "工作流工具"]

    def apply(self, model, lora_stack="[]"):
        try:
            stack = json.loads(lora_stack)
        except Exception:
            return (model,)

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
                model, _ = comfy.sd.load_lora_for_models(model, None, lora, strength, 0)

        return (model,)
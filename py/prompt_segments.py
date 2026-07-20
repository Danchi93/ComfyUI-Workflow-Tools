import json

class PromptSegments:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "segments": ("STRING", {"default": "[]", "multiline": False}),
                "insert_pos": ("INT", {"default": 1, "min": 1, "step": 1}),
            },
            "optional": {
                "prompts_in": ("STRING", {"forceInput": True}),
                "clip": ("CLIP",),
            }
        }

    RETURN_TYPES = ("STRING", "CONDITIONING")
    RETURN_NAMES = ("prompts_out", "conditioning")
    FUNCTION = "apply"
    CATEGORY = "conditioning"
    SEARCH_ALIASES = ["prompt segments", "multi prompt", "tag suggestion", "workflow tools", "提示词", "多段提示词", "标签联想", "工作流工具"]

    def apply(self, segments="[]", insert_pos=1, prompts_in=None, clip=None):
        try:
            stack = json.loads(segments)
        except Exception:
            return ("", None)

        parts = [
            s.get("text", "").strip()
            for s in stack
            if s.get("enabled", True) and s.get("text", "").strip()
        ]
        result = ", ".join(parts)
        if prompts_in and prompts_in.strip():
            idx = max(0, insert_pos - 1)
            if idx <= 0:
                result = prompts_in.strip() + (", " + result if result else "")
            elif idx >= len(parts):
                result = result + (", " if result else "") + prompts_in.strip()
            else:
                before = parts[:idx]
                after = parts[idx:]
                result = ", ".join(before + [prompts_in.strip()] + after)

        conditioning = None
        if clip is not None and result.strip():
            tokens = clip.tokenize(result)
            conditioning = clip.encode_from_tokens_scheduled(tokens)

        return (result, conditioning)

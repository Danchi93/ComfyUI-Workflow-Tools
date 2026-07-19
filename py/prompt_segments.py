import json

class PromptSegments:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "segments": ("STRING", {"default": "[]", "multiline": False}),
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
    SEARCH_ALIASES = ["prompt segments", "multi prompt", "tag suggestion", "workflow tools"]

    def apply(self, segments="[]", prompts_in=None, clip=None):
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
            result = prompts_in.strip() + (", " + result if result else "")

        conditioning = None
        if clip is not None and result.strip():
            tokens = clip.tokenize(result)
            conditioning = clip.encode_from_tokens_scheduled(tokens)

        return (result, conditioning)

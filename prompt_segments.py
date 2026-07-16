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
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompts_out",)
    FUNCTION = "apply"
    CATEGORY = "conditioning"

    def apply(self, segments="[]", prompts_in=None):
        try:
            stack = json.loads(segments)
        except Exception:
            return ("",)

        parts = [
            s.get("text", "").strip()
            for s in stack
            if s.get("enabled", True) and s.get("text", "").strip()
        ]
        result = ", ".join(parts)
        if prompts_in and prompts_in.strip():
            result = prompts_in.strip() + (", " + result if result else "")
        return (result,)

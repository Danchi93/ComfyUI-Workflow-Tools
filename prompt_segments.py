import json

class PromptSegments:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "segments": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "apply"
    CATEGORY = "conditioning"

    def apply(self, segments="[]"):
        try:
            stack = json.loads(segments)
        except Exception:
            return ("",)

        parts = [
            s.get("text", "").strip()
            for s in stack
            if s.get("enabled", True) and s.get("text", "").strip()
        ]
        return (", ".join(parts),)
import json
import torch

class ResolutionSwitcher:
    """
    Stores a list of (width, height, batch) presets. The frontend toggles
    exactly one row active at a time; the backend builds an empty latent
    from that active preset, mirroring ComfyUI's native EmptyLatentImage.
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "presets": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("LATENT",)
    FUNCTION = "build"
    CATEGORY = "latent"
    SEARCH_ALIASES = ["resolution", "preset", "latent size", "workflow tools"]

    def build(self, presets="[]"):
        # Default: 1024x1024, batch 1
        width, height, batch = 1024, 1024, 1

        try:
            stack = json.loads(presets)
            # The frontend ensures only one row is active at a time, but be
            # defensive: pick the first active one. If none active, fall back
            # to default so the node never errors out.
            for entry in stack:
                if entry.get("active", False):
                    width = int(entry.get("width", 1024))
                    height = int(entry.get("height", 1024))
                    batch = int(entry.get("batch", 1))
                    break
        except Exception:
            pass

        # Snap to multiples of 8 (latent works in 8x downsampled space).
        # Native EmptyLatentImage clamps via the UI step; here we enforce it
        # defensively in case a stale/edited JSON slips through.
        width = max(16, (width // 8) * 8)
        height = max(16, (height // 8) * 8)
        batch = max(1, batch)

        latent = torch.zeros([batch, 4, height // 8, width // 8])
        return ({"samples": latent},)

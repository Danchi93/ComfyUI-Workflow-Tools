class Img2ImgTxt2ImgSwitch:
    """
    Semantically labelled LATENT switch for img2img / txt2img pipelines.
    Functionally identical to the generic Switch node, but the input slots and
    toggle are labelled with the user's actual pipeline names so you never
    confuse which side is which.

    Mode = True  → 文生图 (txt2img)  output = txt2img_latent
    Mode = False → 图生图 (img2img)  output = img2img_latent
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "mode": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "img2img_latent": ("LATENT",),
                "txt2img_latent": ("LATENT",),
            },
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "switch"
    CATEGORY = "latent"

    def switch(self, mode=True, img2img_latent=None, txt2img_latent=None):
        if mode and txt2img_latent is not None:
            return (txt2img_latent,)
        if not mode and img2img_latent is not None:
            return (img2img_latent,)
        # Fallback: prefer whichever side is provided
        if txt2img_latent is not None:
            return (txt2img_latent,)
        if img2img_latent is not None:
            return (img2img_latent,)
        return (None,)
"""Extract palette samples for opaque canopy volumes; preserve the source PNG."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'seed/textures/canopy_cluster_source.png'
OUTPUT = ROOT / 'seed/textures/canopy_cluster.json'
SIZE = 32


def bake():
    image = Image.open(SOURCE).convert('RGBA')
    pixels = [image.getpixel((int((x + .5) * image.width / SIZE),
                             int((y + .5) * image.height / SIZE)))
              for y in range(SIZE) for x in range(SIZE)]
    visible = [pixel[0] for pixel in pixels if pixel[3] > 127]
    return {'size': SIZE, 'mean': sum(visible) / len(visible) / 255,
            'pixels': [[pixel[0], pixel[3]] for pixel in pixels],
            'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()}


if __name__ == '__main__':
    result = json.dumps(bake(), separators=(',', ':')) + '\n'
    if '--check' in sys.argv:
        if OUTPUT.read_text() != result:
            raise SystemExit('Canopy texture data is stale; run python3 scripts/bake_canopy_texture.py')
        print('Canopy texture data matches its source image.')
    else:
        OUTPUT.write_text(result)

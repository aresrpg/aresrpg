"""Export Suicune's editable baked vertex shading without rewriting its rig or compressed geometry.

Open riding.blend first. Baked AO is a linear point-color attribute on the Suicune mesh.
The original Color attribute retains the directional shading before the AO bake.
The bake used the idle pose, a 0.22 m AO distance, 64 samples and 55% AO strength.
"""
import json
import struct
from pathlib import Path

import bpy

repo = next(path for path in Path(__file__).resolve().parents if (path / 'ARCHITECTURE.md').exists())
mesh = next(obj.data for obj in bpy.data.objects
            if obj.type == 'MESH' and obj.parent and obj.parent.name == 'Riding_suicune')
colors = mesh.color_attributes['Baked AO']
assert colors.domain == 'POINT'
path = repo / 'seed/models/pets/suicune.glb'
source = path.read_bytes()
length = struct.unpack_from('<I', source, 12)[0]
model = json.loads(source[20:20 + length])
binary = bytearray(source[28 + length:])
primitive = model['meshes'][0]['primitives'][0]
accessor_index = primitive['attributes']['COLOR_0']
accessor = model['accessors'][accessor_index]
assert accessor['count'] == len(colors.data), 'Geometry changed; rebake and verify vertex correspondence first'
packed = bytes(value for color in colors.data
               for value in [*[round(255 * max(0, min(1, c))) for c in color.color[:3]], 255])
if accessor.get('name') == 'Mesh_3_baked_ao':
    view_index = accessor['bufferView']
    view = model['bufferViews'][view_index]
    assert view['byteLength'] == len(packed) and view['byteStride'] == 4
    offset = view['byteOffset']
    binary[offset:offset + len(packed)] = packed
else:
    view_index = len(model['bufferViews'])
    model['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary),
                                'byteLength': len(packed), 'byteStride': 4, 'target': 34962})
    binary.extend(packed)
model['accessors'][accessor_index] = {'name': 'Mesh_3_baked_ao', 'bufferView': view_index,
                                    'type': 'VEC3', 'componentType': 5121, 'normalized': True,
                                    'count': len(colors.data)}
primitive['extensions']['KHR_draco_mesh_compression']['attributes'].pop('COLOR_0', None)
model['buffers'][0]['byteLength'] = len(binary)
metadata = json.dumps(model, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
path.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(metadata) + len(binary))
                 + struct.pack('<II', len(metadata), 0x4e4f534a) + metadata
                 + struct.pack('<II', len(binary), 0x004e4942) + binary)
print('Exported Suicune baked AO:', path)

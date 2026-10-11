"""Select the approved rig in its family .blend, then run this file to export its canonical mob GLB."""
import copy
import json
import struct
from pathlib import Path

import bpy

ROOT = next(path for path in Path(bpy.data.filepath).resolve().parents if (path / 'ARCHITECTURE.md').is_file())
OUTPUT = ROOT / 'seed/models/mobs'


def pack_variants(path, variants):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    meta = json.loads(raw[20:20 + length])
    binary = bytearray(raw[28 + length:])
    template = copy.deepcopy(meta['materials'][0])
    texture = meta['textures'][template['pbrMetallicRoughness']['baseColorTexture']['index']]
    mappings = []
    for index, (name, image_name) in enumerate(variants.items()):
        if index:
            png = bytes(bpy.data.images[image_name].packed_file.data)
            binary += b'\0' * (-len(binary) % 4)
            view = len(meta['bufferViews'])
            meta['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(png)})
            binary += png
            image = len(meta['images'])
            meta['images'].append({'mimeType': 'image/png', 'bufferView': view, 'name': name})
            material = copy.deepcopy(template)
            material['pbrMetallicRoughness']['baseColorTexture']['index'] = len(meta['textures'])
            meta['textures'].append({'source': image, **({'sampler': texture['sampler']} if 'sampler' in texture else {})})
            meta['materials'].append(material)
        meta['materials'][index]['name'] = name
        mappings.append({'material': index, 'variants': [index]})
    meta.setdefault('extensions', {})['KHR_materials_variants'] = {'variants': [{'name': name} for name in variants]}
    if 'KHR_materials_variants' not in meta.setdefault('extensionsUsed', []):
        meta['extensionsUsed'].append('KHR_materials_variants')
    for mesh in meta['meshes']:
        for primitive in mesh['primitives']:
            primitive.setdefault('extensions', {})['KHR_materials_variants'] = {'mappings': mappings}
    binary += b'\0' * (-len(binary) % 4)
    meta['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(meta, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    chunks = struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(binary), 0x004e4942) + binary
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, len(chunks) + 12) + chunks)


def export_model(rig):
    scene = bpy.data.scenes[rig['model_scene']]
    bpy.context.window.scene = scene
    meshes = [obj for obj in scene.objects if obj.type == 'MESH' and obj.parent == rig]
    assert len(meshes) == 1, rig.name
    death = next(track.strips[0] for track in rig.animation_data.nla_tracks if track.name == 'DEATH')
    assert abs((death.frame_end - death.frame_start) / (scene.render.fps / scene.render.fps_base) - 1) < 1e-5
    action, slot = rig.animation_data.action, rig.animation_data.action_slot
    texture = next(node for node in meshes[0].data.materials[0].node_tree.nodes if node.type == 'TEX_IMAGE')
    original_image = texture.image
    variants = dict(rig.get('material_variants', {}))
    path = OUTPUT / (rig['mob_type'] + '.glb')
    try:
        if variants:
            texture.image = bpy.data.images[next(iter(variants.values()))]
        rig.animation_data.action = None
        for obj in scene.objects:
            obj.select_set(obj == rig or obj in meshes)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(
            filepath=str(path), export_format='GLB', use_selection=True, use_active_scene=True,
            export_animations=True, export_animation_mode='NLA_TRACKS', export_anim_single_armature=False,
            export_anim_slide_to_zero=True, export_force_sampling=False,
            export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12,
            export_meshopt_compression_enable=False, export_materials='EXPORT',
        )
        if variants:
            pack_variants(path, variants)
    finally:
        texture.image = original_image
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        scene.frame_set(1)
    print('EXPORTED', path, path.stat().st_size)


selected_models = [obj for obj in bpy.context.selected_objects if obj.type == 'ARMATURE' and 'mob_type' in obj]
assert selected_models, 'Select the approved model rig before exporting'
for model in selected_models:
    export_model(model)

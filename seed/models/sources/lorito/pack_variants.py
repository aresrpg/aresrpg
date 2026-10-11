import bpy
import json
import struct
import copy
from pathlib import Path
folder=Path(bpy.data.filepath).resolve().parent
repo=next(path for path in folder.parents if (path/'ARCHITECTURE.md').is_file())
palettes={'lorito':json.loads((folder/'palettes.json').read_text())}
for family,skins in palettes.items():
    data=(folder/'lorito_base.glb').read_bytes();length=struct.unpack_from('<I',data,12)[0]
    meta=json.loads(data[20:20+length]);binary=bytearray(data[28+length:])
    template=copy.deepcopy(meta['materials'][0])
    source_texture=template['pbrMetallicRoughness']['baseColorTexture']['index']
    sampler=meta['textures'][source_texture].get('sampler')
    mappings=[]
    for index,skin in enumerate(skins):
        if index==0:
            material_index=0
            meta['materials'][0]['name']=skin
        else:
            png=bytes(bpy.data.images[f'{skin}.png'].packed_file.data)
            binary+=b'\0'*((-len(binary))%4)
            view=len(meta['bufferViews']);meta['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(png)})
            binary+=png
            image=len(meta['images']);meta['images'].append({'mimeType':'image/png','bufferView':view,'name':skin})
            texture=len(meta['textures']);meta['textures'].append({'source':image,**({'sampler':sampler} if sampler is not None else {})})
            material=copy.deepcopy(template);material['name']=skin;material['pbrMetallicRoughness']['baseColorTexture']['index']=texture
            material_index=len(meta['materials']);meta['materials'].append(material)
        mappings.append({'material':material_index,'variants':[index]})
    meta.setdefault('extensions',{})['KHR_materials_variants']={'variants':[{'name':skin} for skin in skins]}
    if 'KHR_materials_variants' not in meta.setdefault('extensionsUsed',[]):meta['extensionsUsed'].append('KHR_materials_variants')
    for mesh in meta['meshes']:
        for primitive in mesh['primitives']:primitive.setdefault('extensions',{})['KHR_materials_variants']={'mappings':mappings}
    binary+=b'\0'*((-len(binary))%4);meta['buffers'][0]['byteLength']=len(binary)
    raw=json.dumps(meta,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
    chunks=struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
    output=(repo/'seed/models/mobs')/'lorito.glb'
    output.write_bytes(struct.pack('<III',0x46546c67,2,len(chunks)+12)+chunks)
    print(output,output.stat().st_size,'bytes',len(skins),'variants')

meta['meshes'][0]['primitives'][0]['material']=list(palettes['lorito']).index('golden')
for scene in meta['scenes']:
    roots=scene['nodes'];scene['nodes']=[len(meta['nodes'])]
    meta['nodes'].append({'name':'GoldenLoritoScale','children':roots,'scale':[1.48]*3})
raw=json.dumps(meta,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
chunks=struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
output=(repo/'seed/models/mobs/golden_lorito.glb')
output.write_bytes(struct.pack('<III',0x46546c67,2,len(chunks)+12)+chunks)
print(output,output.stat().st_size,'bytes; shared redesigned family geometry, golden palette, 1.48 scale')

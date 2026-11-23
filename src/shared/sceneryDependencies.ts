import type { PmsMapData, PmsProp, PmsSceneryDef } from './pmsParser';
/** Preserve source padding, unrelated float bits, position and ordering when patching a PMS prop. */
export function patchPropFields(prop: PmsProp, fields: Partial<Pick<PmsProp, 'style' | 'width' | 'height'>>): PmsProp {
    const updated = { ...prop, ...fields };
    if (prop.raw?.byteLength === 44) {
        const raw = Uint8Array.from(prop.raw), view = new DataView(raw.buffer);
        if (fields.style !== undefined)
            view.setUint16(2, fields.style, true);
        if (fields.width !== undefined)
            view.setInt32(4, fields.width, true);
        if (fields.height !== undefined)
            view.setInt32(8, fields.height, true);
        updated.raw = raw;
    }
    return updated;
}
export function pruneUnusedScenery(map: Pick<PmsMapData, 'props' | 'scenery'>): {
    props: PmsProp[];
    scenery: PmsSceneryDef[];
    removedCount: number;
} {
    const usage = new Uint32Array(map.scenery.length + 1);
    for (const [i, p] of map.props.entries()) {
        if (!p.active || p.level > 2)
            continue;
        if (!Number.isInteger(p.style) || p.style < 1 || p.style > map.scenery.length)
            throw Error('Invalid active prop style at prop ' + i + ': ' + p.style);
        usage[p.style]++;
    }
    const remap = new Uint32Array(usage.length), scenery: PmsSceneryDef[] = [];
    for (const [i, def] of map.scenery.entries()) {
        if (!usage[i + 1])
            continue;
        const newIndex = scenery.length + 1;
        remap[i + 1] = newIndex;
        scenery.push({ ...def, index: newIndex, usedCount: usage[i + 1] });
    }
    const props = map.props.map(p => {
        const style = remap[p.style] ?? 0;
        return style === p.style ? p : patchPropFields(p, { style });
    });
    return { props, scenery, removedCount: map.scenery.length - scenery.length };
}

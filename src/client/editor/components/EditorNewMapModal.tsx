import React, { useMemo, useState } from 'react';
import { COURSE_MODES, CourseMode, DEFAULT_COURSE, generateCourseMap } from '@shared/courseGenerator';
import { CourseControls } from './CourseControls';
import type { MapCompactEntry } from '@shared/apiTypes';
import { ReferenceMapBuilder } from './ReferenceMapBuilder';
import { NEW_TUNNEL_SETTINGS, generateClimbTunnel, createTunnelMap, type TunnelSettings, type TunnelPoint } from '@shared/climbTunnel';
import type { TunnelMethod } from '../tunnelBlueprint';
import type { TunnelTrialResult } from '../tunnelTrial';
import { createTunnelProject } from '@shared/tunnelProject';
import { TunnelComposer } from './TunnelComposer';
import { NewTimedTunnel, type TimedCourseSelection } from './NewTimedTunnel';
import { loadTestedTunnel, TESTED_TUNNELS, type TestedTunnel } from '../testedTunnels';
import { CoursePreview } from './CoursePreview';
import { TeamCoursePreview } from './TeamCoursePreview';
import { verifyClimbRoute } from '@shared/climbPhysics';

import {
  createMapFromTemplate,
  EDITOR_MAP_TEMPLATES,
  EditorTemplateId,
} from '@shared/editorTemplates';
import { serializePms, soldatCrc32, type PmsMapData } from '@shared/pmsParser';
import { AlertTriangle, FilePlus2, X } from 'lucide-react';
import { t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';

const modeLabels = { climb: 'Platform time trial', ctf: 'CTF', trenchwars: 'Trenchwars', symmetric: 'Symmetric arena' };
const prefixes = { climb: 'ctf_kz', ctf: 'ctf', trenchwars: 'tw', symmetric: 'dm' };

interface EditorNewMapModalProps {
  open: boolean;
  onClose: () => void;
  availableTextures: string[];
  referenceMap?: MapCompactEntry | null;
  hasUnsavedChanges?: boolean; // the map open in the editor has edits that creating a new one would discard
  onCreateMap: (opts: { map: PmsMapData; initialBaseName: string; fullRun?: TunnelTrialResult; tunnel?: {settings:TunnelSettings; method:TunnelMethod} }) => void;
}

export const EditorNewMapModal: React.FC<EditorNewMapModalProps> = ({
  open,
  onClose,
  availableTextures,
  referenceMap,
  hasUnsavedChanges = false,
  onCreateMap,
}) => {
  const cancelSketch = React.useRef<(() => boolean) | null>(null);
  const backdropProps = useModalDismiss(open, () => {
    if (!cancelSketch.current?.()) onClose();
  });
  const [templateId, setTemplateId] = useState<EditorTemplateId>('arena');
  const [baseName, setBaseName] = useState(referenceMap?'style_generated':'ctf_kz_tunnel');
  const [title, setTitle] = useState('Soldat Map Studio Map');
  const [texture, setTexture] = useState('default.bmp');

  const [source,setSource]=useState<'reference'|'tunnel'|'timed'|'courses'|'template'>(referenceMap?'reference':'tunnel');
  const [referenceDraft,setReferenceDraft]=useState<PmsMapData|null>(null);
  const [referenceBusy,setReferenceBusy]=useState(false);
  const [timedSelection,setTimedSelection]=useState<TimedCourseSelection|null>(null);
  const generated=source==='courses';
  const [tunnel,setTunnel]=useState<TunnelSettings>(NEW_TUNNEL_SETTINGS);
  const [profileLoading,setProfileLoading]=useState(false);
  const timedCourse = timedSelection?.terrain===tunnel ? timedSelection.course : null;
  const [method,setMethod]=useState<TunnelMethod>('auto');
  const [path,setPath]=useState<TunnelPoint[]>([]);
  const tunnelDraft=useMemo(()=>open && source==='tunnel' && (method==='auto' || path.length>=2)
    ? generateClimbTunnel(tunnel,method==='draw'?path:undefined) : null,[open,source,method,path,tunnel]);
  const [mode, setMode] = useState<CourseMode>('climb');
  const [settings, setSettings] = useState(DEFAULT_COURSE);
  const [measuring,setMeasuring] = useState(false);
  const draft = useMemo(() => generated ? generateCourseMap(mode, settings, {
    title: title.trim() || baseName, texture: texture.trim() || 'default.bmp',
  }) : null, [generated, mode, settings, title, baseName, texture]);
  const run = useMemo(() => draft && mode==='climb' ? verifyClimbRoute(draft,true) : null, [draft,mode]);
  if (!open) return null;
  const awaitingProfile = source==='tunnel' && profileLoading;
  const createDisabled = (source==='reference' && (!referenceDraft || referenceBusy)) || awaitingProfile || (!!run && (measuring || !run.reached)) ||
    (source==='tunnel' && !!tunnelDraft && !tunnelDraft.validation.ok) || (source==='timed' && !timedCourse);

  const selectTemplate = (id: EditorTemplateId) => {
    setTemplateId(id);
    const tpl = EDITOR_MAP_TEMPLATES.find((item) => item.id === id);
    if (tpl) {
      setBaseName(tpl.defaultBaseName);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createDisabled) return;
    const cleanBase =
      baseName
        .trim()
        .replace(/\.pms$/i, '')
        .replace(/[<>:"/\\|?*]+/g, '_') || 'dm_newmap';
    const header={title:title.trim() || cleanBase,texture:texture.trim() || 'default.bmp'};
    if(source==='reference' && referenceDraft){
      const created={...referenceDraft,mapName:header.title};
      created.crc32=soldatCrc32(serializePms(created));
      onCreateMap({map:created,initialBaseName:cleanBase});
      onClose();
      return;
    }
    if (source==='timed' && timedCourse) {
      const created = {...timedCourse.map,mapName:header.title,texture:header.texture};
      created.crc32 = soldatCrc32(serializePms(created));
      onCreateMap({map:created,initialBaseName:cleanBase,fullRun:timedCourse.trial,
        tunnel:{settings:created.editorTunnels![0].settings,method:'auto'}});
      onClose();
      return;
    }
    const created = source==='tunnel' ? (tunnelDraft ? createTunnelMap(tunnelDraft,tunnel,header) : createMapFromTemplate('empty',header)) :
      draft ?? createMapFromTemplate(templateId,header);
    if (source==='tunnel') {
      if (tunnelDraft) created.editorTunnels=[createTunnelProject(tunnelDraft,tunnel,method==='draw'?path:undefined)];
      else created.editorSketch={method,settings:tunnel,path};
    }
    onCreateMap({ map:created,initialBaseName:cleanBase,
      tunnel:source==='tunnel'?{settings:tunnel,method}:undefined });
    onClose();
  };

  return (
    <div
      {...backdropProps} aria-label={t('Create New Soldat Map')}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        // With unsaved edits, creating discards them and their recovery draft: Enter in a field must not do that,
        // only a click on "Discard changes and create"
        onKeyDown={(e) => {
          if (hasUnsavedChanges && e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
        }}
        className="flex w-full max-w-4xl max-h-[92vh] flex-col overflow-hidden bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl"
      >
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100">{t('Create New Soldat Map')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="space-y-1.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {([['reference','Map from examples'],['tunnel','Climb tunnel'],['timed','Timed climb'],['courses','Courses and arenas'],['template','Starter template']] as const).map(([id,label])=>
                <button key={id} type="button" aria-pressed={source===id}
                  className={source===id?'rounded-md bg-cyan-500/15 px-2.5 py-1.5 font-semibold text-cyan-200':'px-2.5 py-1.5 text-zinc-400'}
                  onClick={()=>{if(id===source) return;setReferenceDraft(null);setTimedSelection(null);setSource(id);setBaseName(id==='reference'?'style_generated':id==='timed'?'ctf_kz_time_trial':id==='tunnel'?'ctf_kz_tunnel':id==='courses'?prefixes[mode]+'_generated':
                    EDITOR_MAP_TEMPLATES.find(tpl=>tpl.id===templateId)!.defaultBaseName);}}>{t(label)}</button>)}
              {source === 'tunnel' && <select value="" aria-label={t('Load a tested course')}
                className="ml-auto max-w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
                onChange={e=>{
                  const key = e.target.value as TestedTunnel;
                  if (!Object.hasOwn(TESTED_TUNNELS, key)) return;
                  const preset = loadTestedTunnel(key);
                  setTunnel(preset.settings);
                  setMethod(preset.method);
                  setPath(preset.path);
                  setBaseName(preset.name);
                }}>
                <option value="">{t('Load a tested course')}</option>
                {(Object.keys(TESTED_TUNNELS) as TestedTunnel[]).map(key=>
                  <option key={key} value={key}>{t(TESTED_TUNNELS[key].label)}</option>)}
              </select>}
            </div>
             {source==='reference' ? <ReferenceMapBuilder initial={referenceMap} onBusy={setReferenceBusy} onReady={(m,name)=>{
               setReferenceDraft(m);
               if(m && name)setBaseName(current=>current==='style_generated'||/^(?:[a-z0-9]+_)?style_\d+$/i.test(current)?name:current);
             }}/> :
             source==='timed' ? <NewTimedTunnel terrain={tunnel} setTerrain={setTunnel} course={timedCourse} onReady={setTimedSelection}/> :
             source==='tunnel' ? <TunnelComposer settings={tunnel} setSettings={setTunnel} method={method}
                setMethod={setMethod} path={path} setPath={setPath} draft={tunnelDraft} cancelSketch={cancelSketch}
                onProfileLoading={setProfileLoading} modal/> :
             generated && draft ? <div className="space-y-3">
              <select aria-label={t('Map type')} className="rounded bg-zinc-950 border border-zinc-700 p-2" value={mode}
                onChange={e => {const id = e.target.value as CourseMode; setMode(id); setBaseName(prefixes[id] + '_generated');}}>
                {COURSE_MODES.map(id => <option key={id} value={id}>{t(modeLabels[id])}</option>)}
              </select>
              <CourseControls value={settings} onChange={setSettings} materials={mode === 'climb'} climb={mode === 'climb'} onMeasuring={setMeasuring}/>
              {mode==='ctf' || mode==='trenchwars' ? <TeamCoursePreview map={draft} mode={mode}/> : <CoursePreview map={draft} trace={run?.trace}/>}
              {run && <p role="status" className={run.reached?'text-emerald-300':'text-amber-300'}>
                {run.reached ? t('Simulated to the flag without jets: {jumps} jumps, {time} s.', {
                  jumps:run.jumps,time:(run.ticks/60).toFixed(1)}) :
                  t('Simulation stopped at jump {n}. Change the seed or spacing.', {n:run.failedLeg ?? 1})}
                {' '}{!settings.profile?.jumps.length && t('Using built-in jump distances.')}
              </p>}
            </div> : (
            <div className="grid grid-cols-2 gap-2">
              {EDITOR_MAP_TEMPLATES.map((tpl) => {
                const selected = tpl.id === templateId;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-100'
                        : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="font-semibold text-xs">{t(tpl.nameEn)}</div>
                    <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                      {t(tpl.descriptionEn)}
                    </div>
                  </button>
                );
              })}
            </div>)}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold text-zinc-300">{t('File name (without .pms)')}</span>
              <input
                type="text"
                value={baseName}
                maxLength={32}
                onChange={(e) => setBaseName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 font-mono text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-zinc-300">{t('Main texture (<= 24 chars)')}</span>
              <input
                type="text"
                list="sms-newmap-textures"
                value={source==='reference' ? referenceDraft?.texture??'' : texture}
                readOnly={source==='reference'}
                maxLength={24}
                onChange={(e) => setTexture(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 font-mono text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
              <datalist id="sms-newmap-textures">
                {availableTextures.map((tex) => (
                  <option key={tex} value={tex} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="font-semibold text-zinc-300">
              {t('Map description in PMS header (<= 38 chars)')}
            </span>
            <input
              type="text"
              value={title}
              maxLength={38}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>

        {hasUnsavedChanges && (
          <div className="mx-5 mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/35 text-amber-100 text-[11px] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{t('The map open in the editor has unsaved changes. Creating a new map discards them.')}</span>
          </div>
        )}

        <div className="px-5 py-3 bg-zinc-950/70 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
          >
            {t('Cancel')}
          </button>
          <button
            type="submit" disabled={createDisabled}
            className={`px-4 py-1.5 rounded-md text-xs font-bold text-white cursor-pointer disabled:cursor-default disabled:opacity-55 ${
              hasUnsavedChanges ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {awaitingProfile ? t('Measuring local climb maps…') : hasUnsavedChanges ? t('Discard changes and create') :
              source==='tunnel' && !tunnelDraft ? t('Draw on a blank map') : t('Create & Open in Editor')}
          </button>
        </div>
      </form>
    </div>
  );
};

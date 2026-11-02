import React, { useState } from 'react';
import {
  createMapFromTemplate,
  EDITOR_MAP_TEMPLATES,
  EditorTemplateId,
} from '@shared/editorTemplates';
import { PmsMapData } from '@shared/pmsParser';
import { AlertTriangle, FilePlus2, X } from 'lucide-react';
import { t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';

interface EditorNewMapModalProps {
  open: boolean;
  onClose: () => void;
  availableTextures: string[];
  hasUnsavedChanges?: boolean; // the map open in the editor has edits that creating a new one would discard
  onCreateMap: (opts: { map: PmsMapData; initialBaseName: string }) => void;
}

export const EditorNewMapModal: React.FC<EditorNewMapModalProps> = ({
  open,
  onClose,
  availableTextures,
  hasUnsavedChanges = false,
  onCreateMap,
}) => {
  const backdropProps = useModalDismiss(open, onClose);
  const [templateId, setTemplateId] = useState<EditorTemplateId>('arena');
  const [baseName, setBaseName] = useState('dm_newmap');
  const [title, setTitle] = useState('Soldat Map Studio Map');
  const [texture, setTexture] = useState('default.bmp');

  if (!open) return null;

  const selectTemplate = (id: EditorTemplateId) => {
    setTemplateId(id);
    const tpl = EDITOR_MAP_TEMPLATES.find((item) => item.id === id);
    if (tpl) {
      setBaseName(tpl.defaultBaseName);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanBase =
      baseName
        .trim()
        .replace(/\.pms$/i, '')
        .replace(/[<>:"/\\|?*]+/g, '_') || 'dm_newmap';
    const created = createMapFromTemplate(templateId, {
      title: title.trim() || cleanBase,
      texture: texture.trim() || 'default.bmp',
    });
    onCreateMap({ map: created, initialBaseName: cleanBase });
    onClose();
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100">{t('Create New Soldat Map')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-300">{t('Starter template')}</label>
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
            </div>
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
                value={texture}
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
            type="submit"
            className={`px-4 py-1.5 rounded-md text-xs font-bold text-white cursor-pointer ${
              hasUnsavedChanges ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {hasUnsavedChanges ? t('Discard changes and create') : t('Create & Open in Editor')}
          </button>
        </div>
      </form>
    </div>
  );
};

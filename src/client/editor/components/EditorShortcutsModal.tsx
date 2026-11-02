import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';
import { EDITOR_TOOLS } from './EditorToolRail';

const GROUPS: ReadonlyArray<{ titleEn: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    titleEn: 'File & history',
    rows: [
      ['Ctrl+S', 'Save (again to the same file after the first save)'],
      ['Ctrl+Shift+S', 'Save as…'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
      ['Ctrl+K', 'Command palette'],
      ['?  /  F1', 'This list'],
    ],
  },
  {
    titleEn: 'Selection',
    rows: [
      ['Click, Shift+Click', 'Select, add / remove'],
      ['Repeat click', 'Next object under the cursor'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+Shift+A', 'Select similar (same image, type, path…)'],
      ['Ctrl+I', 'Invert selection'],
      ['Esc', 'Cancel the drawing or clear the selection'],
    ],
  },
  {
    titleEn: 'Editing',
    rows: [
      ['Arrows (Shift)', 'Nudge by 1 unit (by the grid size)'],
      ['Ctrl+C / Ctrl+V', 'Copy / paste (also between maps)'],
      ['Ctrl+D', 'Duplicate'],
      ['Delete', 'Delete'],
      ['[ / ]', 'Smaller / larger (brush radius with the brush tools)'],
      ['; / \'', 'Turn 15° left / right'],
      ['PgUp / PgDn (Shift)', 'Draw order one step (to the front / back)'],
      ['Alt+Wheel', 'Scale sceneries (Alt+Shift+Wheel: turn)'],
    ],
  },
  {
    titleEn: 'View',
    rows: [
      ['Wheel', 'Zoom at the cursor'],
      ['Space+drag, middle button', 'Pan'],
      ['Shift+F', 'Zoom to the selection'],
      ['Home', 'Zoom to the whole map'],
      ['Tab', 'Hide / show the side panels'],
      ['G', 'Snap to grid on / off'],
    ],
  },
];

/** Every editor shortcut in one place (opened with ? or F1) */
export const EditorShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const backdropProps = useModalDismiss(open, onClose);
  if (!open) return null;
  const kbd = (k: string) => (
    <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 whitespace-nowrap">
      {k}
    </kbd>
  );
  return (
    <div {...backdropProps} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between sticky top-0 bg-zinc-900">
          <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-cyan-300" />
            {t('Keyboard shortcuts')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="text-zinc-400 hover:text-zinc-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          <section className="space-y-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t('Tools')}</h3>
            {EDITOR_TOOLS.map((tool) => (
              <div key={tool.id} className="flex items-center justify-between gap-3">
                <span className="text-zinc-300 truncate">{t(tool.labelEn)}</span>
                {kbd(tool.shortcut)}
              </div>
            ))}
          </section>
          {GROUPS.map((g) => (
            <section key={g.titleEn} className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t(g.titleEn)}</h3>
              {g.rows.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-3">
                  <span className="text-zinc-300">{t(what)}</span>
                  {kbd(t(keys))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

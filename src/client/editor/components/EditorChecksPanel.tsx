import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Lightbulb, LocateFixed, Loader2, Wrench, XCircle } from 'lucide-react';
import { t } from '../../i18n';
import type { EditorValidationIssueUI } from './EditorRightDock';

interface EditorChecksPanelProps {
  issues: EditorValidationIssueUI[];
  pending: boolean;
  hintsEnabled: boolean;
  onToggleHints: (enabled: boolean) => void;
  onOpenIssue: (issue: EditorValidationIssueUI) => void;
  onFixIssue: (issue: EditorValidationIssueUI) => void;
}

const SEVERITY_STYLE: Record<EditorValidationIssueUI['severity'], { box: string; icon: string }> = {
  error: { box: 'bg-red-500/10 hover:bg-red-500/20 border-red-500/35 text-red-100', icon: 'text-red-400' },
  warning: { box: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/35 text-amber-100', icon: 'text-amber-400' },
  hint: { box: 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-700/70 text-zinc-300', icon: 'text-sky-300' },
};

const IssueRow: React.FC<{
  issue: EditorValidationIssueUI;
  disabled: boolean;
  onOpen: () => void;
  onFix: () => void;
}> = ({ issue, disabled, onOpen, onFix }) => {
  const style = SEVERITY_STYLE[issue.severity];
  const Icon = issue.severity === 'error' ? XCircle : issue.severity === 'warning' ? AlertTriangle : Lightbulb;
  return (
    <div className={`w-full rounded-lg border flex items-start gap-2 p-2.5 transition-colors ${style.box}`}>
      <button
        type="button"
        onClick={onOpen}
        title={t('Select it and show it on the map')}
        className="min-w-0 flex-1 flex items-start gap-2 text-left cursor-pointer"
      >
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${style.icon}`} />
        <span className="text-xs leading-snug flex-1">{issue.message}</span>
        {(issue.focusBounds || issue.selection) && <LocateFixed className="w-3.5 h-3.5 opacity-70 shrink-0 mt-0.5" />}
      </button>
      {issue.fix && (
        <button
          type="button"
          disabled={disabled}
          onClick={onFix}
          title={issue.fix.kind === 'repair_normals' ? t('Recompute the collision normals of these polygons') : t('Delete these polygons')}
          className="shrink-0 px-1.5 py-0.5 rounded border border-current/30 text-[10px] font-semibold flex items-center gap-1 hover:bg-white/10 cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <Wrench className="w-3 h-3" />
          {t('Fix')}
        </button>
      )}
    </div>
  );
};

/** Validation results grouped by severity; hints (often intentional in real maps) stay folded */
export const EditorChecksPanel: React.FC<EditorChecksPanelProps> = ({
  issues,
  pending,
  hintsEnabled,
  onToggleHints,
  onOpenIssue,
  onFixIssue,
}) => {
  const [hintsOpen, setHintsOpen] = useState(false);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const hints = issues.filter((i) => i.severity === 'hint');

  const row = (issue: EditorValidationIssueUI) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      disabled={pending}
      onOpen={() => onOpenIssue(issue)}
      onFix={() => onFixIssue(issue)}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-zinc-400 min-h-5">
        <span className="flex items-center gap-1.5">
          {pending && <Loader2 className="w-3 h-3 animate-spin text-cyan-300" />}
          {pending ? t('Checking the map…') : t('Checked after every change')}
        </span>
      </div>

      {errors.length === 0 && warnings.length === 0 ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center space-y-1.5 text-emerald-200">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
          <div className="font-semibold">{t('All validation checks passed')}</div>
          <div className="text-[11px] text-emerald-300/80">
            {t('Engine limits, polygon winding, assets, and gameplay entities look healthy.')}
          </div>
        </div>
      ) : (
        <>
          {errors.map(row)}
          {warnings.map(row)}
        </>
      )}

      <div className="pt-1 border-t border-zinc-800/80 space-y-1.5">
        <button
          type="button"
          onClick={() => setHintsOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-zinc-100 cursor-pointer"
        >
          {hintsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Lightbulb className="w-3.5 h-3.5 text-sky-300" />
          <span>{t('Hints ({count})', { count: hints.length })}</span>
        </button>
        {hintsOpen && (
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-[11px] text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={hintsEnabled}
                onChange={(e) => onToggleHints(e.target.checked)}
                className="mt-0.5 accent-cyan-500"
              />
              <span>{t('Also look for gaps narrower than the soldier (7 × 14 u) — slower, many are intentional')}</span>
            </label>
            {hints.length === 0 ? (
              <div className="text-[11px] text-zinc-500 px-1">{t('No hints.')}</div>
            ) : (
              hints.map(row)
            )}
          </div>
        )}
      </div>
    </div>
  );
};

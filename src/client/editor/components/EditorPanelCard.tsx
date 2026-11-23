import type React from 'react';

export const PanelCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-zinc-950/75 border border-zinc-800/90 rounded-lg p-2.5 space-y-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</div>
    {children}
  </div>
);

import { forwardRef, useLayoutEffect, useRef } from 'react';
import { readProjectFile, type OpenedStudioProject } from '../projectFile';
import { t } from '../../i18n';

interface Props {
  onOpen: (project: OpenedStudioProject) => void;
  onError: (message: string) => void;
}

export const ProjectFilePicker = forwardRef<HTMLInputElement, Props>(function ProjectFilePicker({ onOpen, onError }, ref) {
  const lastChoice = useRef(0);
  const callbacks = useRef({ onOpen, onError });
  useLayoutEffect(() => { callbacks.current = { onOpen, onError }; }, [onOpen, onError]);
  useLayoutEffect(() => () => { lastChoice.current++; }, []);
  return <input ref={ref} type="file" accept=".smaproj" hidden aria-label={t('Open project file')}
    onChange={async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const choice = ++lastChoice.current;
      try {
        const project = await readProjectFile(file);
        if (choice === lastChoice.current) callbacks.current.onOpen(project);
      } catch (error) {
        if (choice === lastChoice.current) callbacks.current.onError(error instanceof Error ? error.message : t('The project could not be opened.'));
      }
    }}
  />;
});

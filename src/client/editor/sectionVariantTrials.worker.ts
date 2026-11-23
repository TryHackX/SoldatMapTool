import { compareSectionVariants, type SectionVariantRequest } from './sectionVariantComparison';

self.onmessage = ({data}: MessageEvent<SectionVariantRequest>) => {
  compareSectionVariants(data, event => self.postMessage(event));
};

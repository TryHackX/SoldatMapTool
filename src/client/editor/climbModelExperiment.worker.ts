import {evaluateSectionExperiment,type ExperimentDataset} from '@shared/climbModelExperiment';

self.onmessage=({data}:MessageEvent<ExperimentDataset>)=>self.postMessage(evaluateSectionExperiment(data));


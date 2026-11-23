import { buildTimedCourse, type TimedCourseRequest, type TimedCourseResult, type TimedCourseProgress } from './timedTunnelCourse';

export type TimedCourseEvent = {kind:'progress'; progress:TimedCourseProgress} | {kind:'result'; result:TimedCourseResult | null};

self.onmessage = ({data}:MessageEvent<TimedCourseRequest>) => {
  const report = (e:TimedCourseEvent) => self.postMessage(e);
  const result = buildTimedCourse(data,progress=>report({kind:'progress',progress}));
  report({kind:'result',result});
};

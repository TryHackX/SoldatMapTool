import {checkStopRepairs,type RepairRequest} from './climbStopRepair';

self.onmessage=({data}:MessageEvent<RepairRequest>)=>{
  checkStopRepairs(data,report=>self.postMessage({report}));
  self.postMessage({done:true});
};

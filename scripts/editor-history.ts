import { EditorDocument, emptySelection, translateSelection } from '../src/client/editor/EditorDocument';
import { benchMap,p95 } from './bench-map';

const rows=[];
for (const count of [500,2500,5000]) {
  const map=benchMap(count), doc=new EditorDocument({map}), times:number[]=[];
  global.gc?.();
  const before=process.memoryUsage().heapUsed;
  for(let i=0;i<100;i++) {
    const selection={...emptySelection(),polygons:[(i*47)%count]};
    const at=performance.now();
    const nextMap=translateSelection(doc.getSnapshot().map,selection,1,-1);
    doc.commit({label:'Move polygon',nextMap,nextSelection:selection});
    times.push(performance.now()-at);
  }
  global.gc?.();
  const retained=process.memoryUsage().heapUsed-before;
  const depth=doc.getSnapshot().undoStack.length, final=doc.getSnapshot().map;
  for(let i=0;i<100;i++) doc.undo();
  if(doc.getSnapshot().map!==map || depth!==100) throw new Error('Undo lost the original map');
  for(let i=0;i<100;i++) doc.redo();
  if(doc.getSnapshot().map!==final) throw new Error('Redo lost the edited map');
  rows.push({polygons:count,changes:depth,commitP95ms:+p95(times).toFixed(3),retainedMiB:+(retained/1048576).toFixed(2)});
}
console.table(rows);

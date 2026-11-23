import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TUNNEL, generateClimbTunnel } from '../src/shared/climbTunnel';
import { isTunnelSettings } from '../src/shared/tunnelSketch';
import { tunnelTrialRoute } from '../src/shared/tunnelProject';
import { buildTimedCourse, fitAutomaticCourse } from '../src/client/editor/timedTunnelCourse';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';

test('a new one-minute course replays the verified full run after reopening its project', () => {
  const pace = {targetSeconds:60,profile:'progressive',seed:123} as const;
  const course = buildTimedCourse({terrain:DEFAULT_TUNNEL,pace});
  assert.ok(course?.trial.reached);
  assert.ok(Math.abs(course.trial.ticks / 60 - pace.targetSeconds) <= 0.75,
    'the verified assembled minute course should finish within three quarters of a second');
  assert.ok(course.changes > 0 && course.checkedVariants >= course.changes);
  const reopened = decodeProjectFile(encodeProjectFile('ctf_kz_minute',course.map));
  const project = reopened.tunnels[0];
  assert.deepEqual(project.pace,pace);
  assert.equal(project.settings.terrainProgression,'progressive');
  assert.ok(project.settings.automaticLength! > 7000);
  const {centerline,footholds} = tunnelTrialRoute(project);
  const pilot = runPmsTunnelTrial(reopened.map,centerline,footholds);
  assert.ok(pilot.reached);
  assert.equal(pilot.ticks,course.trial.ticks);
});

test('terrain progression changes clearance along the axis without displacing a drawn route', () => {
  const stroke = [{x:-2100,y:0},{x:0,y:0},{x:2100,y:0}];
  const terrain = {...DEFAULT_TUNNEL,roughness:0,ramps:false,drops:false,lowCeilings:false};
  const forward = generateClimbTunnel({...terrain,terrainProgression:'progressive',automaticLength:13000},stroke);
  const reverse = generateClimbTunnel({...terrain,terrainProgression:'hard-start',automaticLength:600},stroke);
  assert.deepEqual(forward.centerline,reverse.centerline);
  const width = (station:typeof forward.stations[number]) => Math.hypot(station.right.x-station.left.x,station.right.y-station.left.y);
  assert.ok(width(forward.stations[12]) > width(reverse.stations[12])+20);
  assert.ok(width(forward.stations.at(-13)!) < width(reverse.stations.at(-13)!)-20);
  assert.equal(isTunnelSettings({...terrain,automaticLength:Infinity}),false);
  assert.equal(generateClimbTunnel({...terrain,automaticLength:Infinity}).validation.reason,'limit');
});

test('a very long target respects the map budget and returns its actual measured time', () => {
  const fit = fitAutomaticCourse({terrain:{...DEFAULT_TUNNEL,direction:'across'},pace:{targetSeconds:300,profile:'steady',seed:123}});
  assert.ok(fit.best?.trial.reached);
  assert.ok(fit.best.error>100);
  assert.ok(fit.best.map.polygons.length<=5000);
  assert.ok(fit.attempts<=7);
});
